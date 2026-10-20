import { mkdirSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { $ } from "bun";
import { z } from "zod";
import { nodeAdapter, runQuery as runOnAdapter } from "./query";
import { CatalogRow, diffCatalog } from "./file-catalog";
import { ensureTelemetry } from "./telemetry";

const RESOURCES_DIR = join(import.meta.dirname, "..", "resources");
const SCHEMA_DIR = join(RESOURCES_DIR, "schema");

export const LOCAL_HOST = "local";

// Bump only when the scan or a row's file identity changes (source_file, source_line):
// those come from the scan rather than from the line, so they are the one thing a
// re-read restores. Everything else about a row is a projection of raw.data and is
// re-derived in place by reconcilePinned, and content_items rebuilds from raw whenever
// views.sql changes, so neither needs a bump. migrateIfNeeded clears indexed_files when
// the stored version is older, re-importing every file still on disk while leaving rows
// whose file is gone in place. v2: raw ingests all record types, not just chat.
// v3: per-file change catalog (indexed_files).
export const INDEX_VERSION = 3;

export interface Database {
  run(sql: string, params?: Record<string, string | null>): Promise<void>;
  query<T>(sql: string, schema: z.ZodType<T>, params?: Record<string, string | null>): Promise<T[]>;
  close(): void;
}

export const HostPolicy = z.looseObject({ block_egress: z.boolean().optional() });
export type HostPolicy = z.infer<typeof HostPolicy>;

export const Manifest = z.looseObject({
  host: z.string(),
  source: z.string(),
  imported_at: z.string(),
  policy: HostPolicy,
});
export type Manifest = z.infer<typeof Manifest>;

export interface HostEntry {
  host: string;
  root: string;
  policy: HostPolicy;
}

// The oldest storage version that compresses long strings (raw.data, content_items
// text) with ZSTD. A file keeps the version it was created at until compactDatabase.
export const STORAGE_VERSION = "v1.2.0";

// memory_limit bounds only DuckDB's buffer manager, and the views rebuild
// allocates up to half as much again outside it, so the cap leaves that headroom
// below what the writer may use. Insertion order stays off so bulk imports can spill instead
// of pinning blocks up to the memory limit.
const WRITER_CONFIG = {
  memory_limit: "4GiB",
  threads: "4",
  max_temp_directory_size: "32GiB",
  preserve_insertion_order: "false",
  storage_compatibility_version: STORAGE_VERSION,
};

async function createDatabase(dbPath: string): Promise<Database> {
  const instance = await DuckDBInstance.create(dbPath, WRITER_CONFIG);
  const connection = await instance.connect();

  return {
    async run(sql, params = {}) {
      await connection.run(sql, params);
    },

    async query<T>(
      sql: string,
      schema: z.ZodType<T>,
      params: Record<string, string | null> = {},
    ): Promise<T[]> {
      const reader = await connection.runAndReadAll(sql, params);
      return z.array(schema).parse(reader.getRowObjectsJS());
    },

    // Closing the instance (not just the connection) lets DuckDB run its shutdown
    // checkpoint, without which freed blocks from DELETE+INSERT stay unreclaimed.
    close() {
      try {
        connection.closeSync();
      } catch (error) {
        console.error("Failed to close DuckDB connection:", error);
      }
      try {
        instance.closeSync();
      } catch (error) {
        console.error("Failed to close DuckDB instance:", error);
      }
    },
  };
}

async function readSql(dir: string, name: string): Promise<string> {
  return Bun.file(join(dir, `${name}.sql`)).text();
}

function getLocalRoot(projectsDir?: string): string {
  const dir = projectsDir ?? process.env.CLAUDE_PROJECTS_DIR;
  if (dir != null && dir !== "") return dir;

  if (process.env.HOME == null || process.env.HOME === "") {
    throw new Error("Cannot locate projects directory: set CLAUDE_PROJECTS_DIR or HOME");
  }
  return join(process.env.HOME, ".claude", "projects");
}

export function getImportsDir(importsDir?: string): string {
  const dir = importsDir ?? process.env.CLAUDE_SESSION_IMPORTS_DIR;
  if (dir != null && dir !== "") return dir;

  if (process.env.HOME == null || process.env.HOME === "") {
    throw new Error("Cannot locate imports directory: set CLAUDE_SESSION_IMPORTS_DIR or HOME");
  }
  return join(process.env.HOME, ".claude", "session-imports");
}

export function importRoot(label: string, importsDir?: string): string {
  return join(getImportsDir(importsDir), label);
}

// The index lives outside ~/.claude so the one folder can be granted to tools that
// refuse ~/.claude, such as the desktop app's folder access for cloud sessions.
// CLAUDE_SESSION_INDEX_DIR overrides it for tests and dev runs.
export function getDataDir(): string {
  const override = process.env.CLAUDE_SESSION_INDEX_DIR;
  if (override != null && override !== "") return override;
  return defaultDataDir();
}

function defaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const root = xdg != null && xdg !== "" ? xdg : join(homedir(), ".local", "share");
  return join(root, "claude-sessions");
}

// Earlier releases kept the index in the plugin data dir. It moves rather than
// rebuilds because telemetry rows outlive the files they came from.
export async function migrateLegacyIndex(
  dataDir: string,
  pluginDataRoot = join(homedir(), ".claude", "plugins", "data"),
): Promise<void> {
  const candidates = (dirExists(pluginDataRoot) ? readdirSync(pluginDataRoot) : [])
    .filter((name) => name.startsWith("observability-"))
    .map((name) => join(pluginDataRoot, name));
  const found = await Promise.all(candidates.map((dir) => Bun.file(sessionDbPath(dir)).exists()));
  const legacy = candidates.filter((_, i) => found[i]);
  const [source] = legacy;
  if (source === undefined) return;
  if (legacy.length > 1 || dirExists(dataDir)) {
    console.error(
      `session index: found ${[...legacy, dataDir].filter(dirExists).join(", ")}; moving none. Keep one and delete the rest.`,
    );
    return;
  }
  mkdirSync(dirname(dataDir), { recursive: true });
  await $`mv ${source} ${dataDir}`.quiet();
  console.error(`session index: moved ${source} to ${dataDir}`);
}

export function sessionDbPath(dataDir: string): string {
  return join(dataDir, "session.duckdb");
}

export function dirExists(target: string): boolean {
  try {
    readdirSync(target);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return false;
  }
}

export interface ImportedHost {
  label: string;
  root: string;
  manifestPath: string;
  manifest: Manifest;
}

function readDirEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    return [];
  }
}

export async function listImportedHosts(importsDir?: string): Promise<ImportedHost[]> {
  const root = getImportsDir(importsDir);
  const read = await Promise.all(
    readDirEntries(root)
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const hostRoot = join(root, entry.name);
        const manifestPath = join(hostRoot, "manifest.json");
        try {
          return {
            label: entry.name,
            root: hostRoot,
            manifestPath,
            manifest: Manifest.parse(await Bun.file(manifestPath).json()),
          };
        } catch {
          // A missing or undecodable manifest means this directory is not a registered host.
          return null;
        }
      }),
  );
  return read.filter((host) => host !== null);
}

export async function enumerateHosts(
  options: { projectsDir?: string; importsDir?: string } = {},
): Promise<HostEntry[]> {
  const hosts: HostEntry[] = [
    { host: LOCAL_HOST, root: getLocalRoot(options.projectsDir), policy: {} },
  ];

  for (const imported of await listImportedHosts(options.importsDir)) {
    // The directory name is the canonical label (forget.ts/hosts.ts/importRoot all
    // key on it); the manifest's host field is informational and may be hand-edited.
    hosts.push({
      host: imported.label,
      root: join(imported.root, "projects"),
      policy: imported.manifest.policy,
    });
  }

  return hosts;
}

export interface ScannedFile {
  path: string;
  mtime: number;
  size: number;
}

// Scan errors must propagate, never degrade to an empty listing: ensureIndex
// reads a missing path as a deleted file, so a swallowed error (e.g. an
// unreadable subdirectory) would delete every indexed row for the host. The
// missing-root case is handled by the dirExists guard before the scan.
export function scanJsonlFiles(root: string): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const full = join(entry.parentPath, entry.name);
    const file = Bun.file(full);
    files.push({ path: full, mtime: Math.trunc(file.lastModified), size: file.size });
  }
  return files;
}

async function applySchema(db: Database): Promise<void> {
  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- schema files apply in sorted order; later DDL depends on tables earlier DDL created.
    const sql = await Bun.file(join(SCHEMA_DIR, file)).text();
    // oxlint-disable-next-line no-await-in-loop -- schema files apply in sorted order; later DDL depends on tables earlier DDL created.
    await db.run(sql);
  }
  if (!(await tableExists(db, "raw"))) await db.run(await rawDdl(db, "raw"));
}

// raw's shape: the projected columns come from pinned_columns (00_pinned.sql), the
// single source of their names, order and types.
const RAW_SHAPE = `SELECT NULL::VARCHAR AS host, UNNEST(pinned_columns(NULL::JSON)),
  NULL::VARCHAR AS source_file, NULL::BIGINT AS source_line, NULL::JSON AS data`;

// raw.data is most of the file, and queries rarely read it since its hot paths were
// pinned, so it is stored with ZSTD. DuckDB's own pick skips ZSTD for strings averaging
// under zstd_min_string_length (4096), and a transcript line averages about 3.7 KB.
// Compression is set only in CREATE TABLE, which a CREATE TABLE AS cannot carry.
async function rawDdl(db: Database, name: string): Promise<string> {
  const columns = await db.query(
    `SELECT column_name, column_type FROM (DESCRIBE ${RAW_SHAPE})`,
    z.object({ column_name: z.string(), column_type: z.string() }),
  );
  const defs = columns.map(
    (c) =>
      `"${c.column_name}" ${c.column_type}${c.column_name === "data" ? " USING COMPRESSION zstd" : ""}`,
  );
  return `CREATE TABLE ${name} (${defs.join(", ")})`;
}

// Replaces raw with its rows re-derived through the current projection, into a table
// created by rawDdl so the copy keeps raw.data's compression.
async function rewriteRaw(db: Database): Promise<void> {
  await db.run("BEGIN");
  await db.run(await rawDdl(db, "raw_next"));
  await db.run(
    "INSERT INTO raw_next SELECT host, UNNEST(pinned_columns(data)), source_file, source_line, data FROM raw",
  );
  await db.run("DROP TABLE raw");
  await db.run("ALTER TABLE raw_next RENAME TO raw");
  await db.run("COMMIT");
  await db.run("CHECKPOINT");
}

// A raw created before rawDdl stores data as DuckDB chose. Older storage versions have no
// ZSTD for strings, so they are never reported as needing it.
async function rawDataUncompressed(db: Database): Promise<boolean> {
  const [row] = await db.query(
    `SELECT COUNT(*) FILTER (WHERE compression NOT IN ('ZSTD', 'Constant')) > 0
         AND (SELECT tags['storage_version'] FROM duckdb_databases()
              WHERE database_name = current_database()) = $version AS stale
     FROM pragma_storage_info('raw')
     WHERE column_name = 'data' AND segment_type <> 'VALIDITY'`,
    z.object({ stale: z.boolean() }),
    { version: `${STORAGE_VERSION}+` },
  );
  return row?.stale ?? false;
}

// content_items is a table built by views.sql out of raw, so it is discarded and rebuilt
// rather than migrated. Every view is CREATE OR REPLACE and needs nothing.
async function dropDerived(db: Database): Promise<void> {
  await db.run("DROP TABLE IF EXISTS content_items");
}

async function dropEverything(db: Database): Promise<void> {
  await dropDerived(db);
  await db.run("DROP TABLE IF EXISTS raw");
  await db.run("DROP TABLE IF EXISTS indexed_files");
  await db.run("DROP TABLE IF EXISTS meta");
  await db.run("DROP TABLE IF EXISTS index_meta");
}

// Returns whether every file has to be read again. Runs before applySchema, so it can
// only drop tables, never write to one that may not exist yet.
async function migrateIfNeeded(db: Database): Promise<boolean> {
  const [row] = await db.query(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'main' AND table_name = 'raw' AND column_name = 'data'
      ) AS has_data,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'main' AND table_name = 'raw' AND column_name = 'host'
      ) AS has_host,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = 'index_meta'
      ) AS has_version
  `,
    z.object({ has_data: z.boolean(), has_host: z.boolean(), has_version: z.boolean() }),
  );

  // A raw table without data/host predates the verbatim-line column, so its rows carry
  // nothing the projection could be re-applied to and there is nothing to preserve.
  if (!row?.has_data || !row.has_host) {
    await dropEverything(db);
    return false;
  }

  // Querying index_meta is only safe once the table exists.
  const version = row.has_version
    ? ((
        await db.query(
          "SELECT COALESCE(MAX(version), 0) AS version FROM index_meta",
          z.object({ version: z.number() }),
        )
      )[0]?.version ?? 0)
    : 0;
  if (version >= INDEX_VERSION) return false;

  await dropDerived(db);
  return true;
}

async function fileFingerprint(dir: string, name: string): Promise<string> {
  const sql = await readSql(dir, name);
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
}

// content_items is built from raw, so every mutation of raw makes it stale. Clearing the
// fingerprint before the mutation rather than after it is what makes the rebuild survive
// an interrupted run: a process that dies between the write and rebuildViews leaves a
// stale table behind, and only a marker already on disk tells the next run to rebuild it.
// Nothing distinguishes such a table from a current one by inspection.
export async function invalidateDerived(db: Database): Promise<void> {
  await db.run("UPDATE index_meta SET views_hash = NULL");
}

// raw.data holds the verbatim JSONL line and every other raw column is a projection of
// it (00_pinned.sql), so a change to that projection is applied to the rows already in
// the database instead of by re-reading files, which for a deleted session no longer
// exist. Reads raw and replaces it in one statement, which also drops columns the
// projection stopped producing and picks up new ones without an ALTER.
//
// The rewrite materializes a second copy of the table and DuckDB never returns freed
// space to the OS, so it checkpoints and leaves refresh.ts's compaction guard to shrink
// the file. Returns whether raw changed, since content_items is derived from it.
async function reconcilePinned(db: Database): Promise<boolean> {
  const fingerprint = await fileFingerprint(SCHEMA_DIR, "00_pinned");
  const hash = await importHash(db);
  if (hash === fingerprint) {
    // The same rows re-encoded, so nothing derived from raw goes stale.
    if (await rawDataUncompressed(db)) await rewriteRaw(db);
    return false;
  }

  // A null hash is an index built before this check existed. The projection may have
  // changed between that build and the first run to stamp it, so the rewrite is skipped
  // only when raw's columns already match what the projection produces.
  const seeding = hash == null;
  const rewrite = !seeding || !(await rawMatchesProjection(db));

  // Derived state is invalidated either way. An adopted index was built by code that
  // could leave content_items behind a committed import, and its provenance is not
  // recoverable, so the run that adopts it rebuilds once rather than inheriting the
  // question.
  await invalidateDerived(db);
  if (rewrite) await rewriteRaw(db);
  await db.run("UPDATE index_meta SET import_hash = $hash", { hash: fingerprint });
  return rewrite;
}

async function importHash(db: Database): Promise<string | null | undefined> {
  if (!(await tableExists(db, "index_meta"))) return undefined;
  // SELECT * because an index_meta older than import_hash lacks the column.
  const [row] = await db.query(
    "SELECT * FROM index_meta",
    z.looseObject({ import_hash: z.string().nullish() }),
  );
  return row?.import_hash;
}

const ColumnName = z.object({ column_name: z.string() });

async function columnNames(db: Database, sql: string): Promise<string> {
  const rows = await db.query(sql, ColumnName);
  return rows.map((r) => r.column_name).join(",");
}

async function rawMatchesProjection(db: Database): Promise<boolean> {
  const live = await columnNames(
    db,
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'raw' ORDER BY ordinal_position`,
  );
  const projected = await columnNames(
    db,
    `SELECT column_name FROM (
       DESCRIBE SELECT host, UNNEST(pinned_columns(NULL::JSON)), source_file, source_line, data
       FROM raw
     )`,
  );
  return live === projected;
}

export async function getDb(dataDir: string): Promise<Database> {
  if (dataDir === defaultDataDir()) await migrateLegacyIndex(dataDir);
  return createDatabase(sessionDbPath(dataDir));
}

// Returns whether raw's projected columns were re-derived, which invalidates the tables
// views.sql builds from it.
export async function ensureSchema(db: Database): Promise<boolean> {
  const needsReimport = await migrateIfNeeded(db);
  await applySchema(db);

  // Invalidating the catalog's stats makes ensureIndex treat every file as changed, so
  // each is re-read inside import.sql's own transaction. Emptying raw up front would
  // leave nothing behind if the reimport failed partway. The catalog's rows stay, so the
  // ordinary removed-file reap still drops rows for files deleted since the last run and
  // the index remains a mirror of what is on disk.
  if (needsReimport) {
    await db.run("UPDATE indexed_files SET mtime = -1, size = -1");
  }

  const [row] = await db.query("SELECT COUNT(*) AS n FROM index_meta", z.object({ n: z.bigint() }));
  await (!row || row.n === 0n
    ? db.run(`INSERT INTO index_meta VALUES (${INDEX_VERSION}, NULL, NULL)`)
    : db.run(`UPDATE index_meta SET version = ${INDEX_VERSION}`));
  return reconcilePinned(db);
}

async function tableExists(db: Database, name: string): Promise<boolean> {
  const [row] = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'main' AND table_name = $name
     ) AS present`,
    z.object({ present: z.boolean() }),
    { name },
  );
  return row?.present ?? false;
}

export async function rebuildViews(db: Database): Promise<void> {
  await db.run(await readSql(RESOURCES_DIR, "views"));
}

const deleteScoped = (table: string) =>
  `DELETE FROM ${table} t WHERE EXISTS (
     SELECT 1 FROM content_item_scope c
     WHERE c.host = t.host AND c.session_id IS NOT DISTINCT FROM t.session_id
   )`;

const FieldChanges = z.object({ added: z.bigint(), removed: z.bigint() });

// Replaces the content_items and search_items rows of the sessions in content_item_scope,
// and the file_fields rows of the files in field_scope, with what a full rebuild would
// produce for them, in one transaction. search_items reads content_items, so it goes
// second. Returns how many (host, type, path) keys the registry gained and lost.
async function rebuildScoped(db: Database): Promise<z.infer<typeof FieldChanges>> {
  await db.run("BEGIN");
  await db.run(deleteScoped("content_items"));
  await db.run(deleteScoped("search_items"));
  await db.run("INSERT INTO content_items SELECT * FROM content_item_rows(true)");
  await db.run("INSERT INTO search_items SELECT * FROM search_item_rows(true)");
  await db.run(
    "CREATE OR REPLACE TEMP TABLE field_keys AS SELECT DISTINCT host, type, path FROM file_fields",
  );
  await db.run(`DELETE FROM file_fields f WHERE EXISTS (
    SELECT 1 FROM field_scope s WHERE s.host = f.host AND s.source_file = f.source_file
  )`);
  await db.run("INSERT INTO file_fields SELECT * FROM field_rows(true)");
  await db.run("COMMIT");
  const [changes] = await db.query(
    `WITH now AS (SELECT DISTINCT host, type, path FROM file_fields)
     SELECT (SELECT COUNT(*) FROM (FROM now EXCEPT FROM field_keys)) AS added,
            (SELECT COUNT(*) FROM (FROM field_keys EXCEPT FROM now)) AS removed`,
    FieldChanges,
  );
  return changes ?? { added: 0n, removed: 0n };
}

// One transaction: a partial forget that kept indexed_files rows would make a later
// re-import of the same label skip every unchanged file while raw stays empty. The views
// rebuild drops the host from content_items. CHECKPOINT cannot run inside a transaction.
//
// Marking the derived tables stale first is what keeps a forget durable. A crash between
// the commit and the rebuild would otherwise leave the host's rows in content_items with
// nothing left to ask for their removal: its files are gone, so no later refresh sees a
// change. Returns the number of raw rows removed.
export async function forgetHost(db: Database, host: string): Promise<number> {
  const [row] = await db.query(
    "SELECT COUNT(*) AS n FROM raw WHERE host = $host",
    z.object({ n: z.bigint() }),
    { host },
  );
  await invalidateDerived(db);
  await deleteHostRows(db, host);
  await rebuildViews(db);
  await db.run("CHECKPOINT");
  return Number(row?.n ?? 0n);
}

// The committed half of a forget, exported so an interrupted one can be reproduced.
export async function deleteHostRows(db: Database, host: string): Promise<void> {
  await db.run("BEGIN");
  await db.run("DELETE FROM raw WHERE host = $host", { host });
  await db.run("DELETE FROM indexed_files WHERE host = $host", { host });
  await db.run("DELETE FROM meta WHERE host = $host", { host });
  await db.run("COMMIT");
}

async function removeFile(db: Database, host: string, file: string): Promise<void> {
  await db.run("BEGIN");
  await db.run(
    `INSERT INTO content_item_scope
     SELECT DISTINCT host, session_id FROM raw
     WHERE host = $host AND source_file = $path AND type IN ('user', 'assistant')`,
    { host, path: file },
  );
  await db.run("INSERT INTO field_scope VALUES ($host, $path)", { host, path: file });
  await db.run("DELETE FROM raw WHERE host = $host AND source_file = $path", {
    host,
    path: file,
  });
  await db.run("DELETE FROM indexed_files WHERE host = $host AND path = $path", {
    host,
    path: file,
  });
  await db.run("COMMIT");
}

export interface IndexResult {
  corpusBytes: number;
  changedFiles: number;
  removedFiles: number;
  /** (host, type, path) keys an incremental refresh added to and dropped from `fields`. */
  fieldsNew: number;
  fieldsGone: number;
  /** Wall time per refresh phase, summed across hosts. */
  phasesMs: Record<"schema" | "scan" | "import" | "telemetry" | "views" | "checkpoint", number>;
}

export async function ensureIndex(
  db: Database,
  options: { projectsDir?: string; importsDir?: string } = {},
): Promise<IndexResult> {
  const phasesMs: IndexResult["phasesMs"] = {
    schema: 0,
    scan: 0,
    import: 0,
    telemetry: 0,
    views: 0,
    checkpoint: 0,
  };
  let mark = performance.now();
  const lap = (phase: keyof typeof phasesMs): void => {
    const now = performance.now();
    phasesMs[phase] += now - mark;
    mark = now;
  };

  const pinnedRederived = await ensureSchema(db);
  // Read before the import loop clears it: a hash that already disagrees means views.sql
  // changed or an earlier run died before rebuilding, and either calls for a full rebuild.
  const viewsFingerprint = await fileFingerprint(RESOURCES_DIR, "views");
  const [metaRow] = await db.query(
    "SELECT views_hash FROM index_meta",
    z.object({ views_hash: z.string().nullable() }),
  );
  const viewsStale = metaRow?.views_hash !== viewsFingerprint;
  await db.run("DELETE FROM content_item_scope");
  await db.run("DELETE FROM field_scope");
  lap("schema");

  const importSql = await readSql(RESOURCES_DIR, "import");
  let corpusBytes = 0;
  let changedFiles = 0;
  let removedFiles = 0;
  // reconcilePinned already cleared the fingerprint when it rewrote raw.
  let derivedInvalidated = pinnedRederived;

  for (const entry of await enumerateHosts(options)) {
    // A missing root is a transient or misconfigured mount (or a typo'd
    // CLAUDE_PROJECTS_DIR), never "every file was deleted": skip the host
    // rather than dropping all its rows. forget.ts deletes rows explicitly.
    if (!dirExists(entry.root)) continue;
    const scanned = scanJsonlFiles(entry.root);
    corpusBytes += scanned.reduce((sum, f) => sum + f.size, 0);

    // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh; concurrent statements on it interleave.
    const indexed = await db.query(
      "SELECT path, mtime, size FROM indexed_files WHERE host = $host",
      CatalogRow,
      { host: entry.host },
    );
    const { changed, removed } = diffCatalog(scanned, indexed);
    lap("scan");

    if (!derivedInvalidated && (changed.length > 0 || removed.length > 0)) {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh; concurrent statements on it interleave.
      await invalidateDerived(db);
      derivedInvalidated = true;
    }

    // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the per-file import below reads back.
    await db.run("SET VARIABLE host = $host", { host: entry.host });
    for (const file of changed) {
      // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the import statement below reads back.
      await db.run("SET VARIABLE source_path = $path", { path: file.path });
      // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the import statement below reads back.
      await db.run("SET VARIABLE source_mtime = $mtime", { mtime: String(file.mtime) });
      // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the import statement below reads back.
      await db.run("SET VARIABLE source_size = $size", { size: String(file.size) });
      // oxlint-disable-next-line no-await-in-loop -- reads the SET VARIABLE state set just above; overlapping imports would cross files.
      await db.run(importSql);
    }
    for (const file of removed) {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh; concurrent statements on it interleave.
      await removeFile(db, entry.host, file.path);
    }

    if (changed.length > 0 || removed.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh; concurrent statements on it interleave.
      await db.run("DELETE FROM meta WHERE host = $host", { host: entry.host });
      // oxlint-disable-next-line no-await-in-loop -- the insert must follow the delete above on the same connection.
      await db.run("INSERT INTO meta VALUES ($host, CURRENT_TIMESTAMP)", { host: entry.host });
    }
    changedFiles += changed.length;
    removedFiles += removed.length;
    lap("import");
  }

  const telemetryChanged = await ensureTelemetry(db, getLocalRoot(options.projectsDir), LOCAL_HOST);
  lap("telemetry");

  // A stale views_hash, a re-derived raw, or a missing table rebuilds content_items in
  // full. Otherwise only the sessions the imports touched are rebuilt. The one path that
  // clears no fingerprint is an INDEX_VERSION bump against an empty corpus, which drops
  // content_items and then imports no file, so the table's presence is checked too.
  const wrote = changedFiles > 0 || removedFiles > 0 || pinnedRederived;
  const viewsChanged = viewsStale || pinnedRederived || !(await tableExists(db, "content_items"));
  let fields = { added: 0n, removed: 0n };
  if (viewsChanged) {
    await rebuildViews(db);
  } else if (wrote) {
    fields = await rebuildScoped(db);
  }
  if (viewsChanged || wrote) {
    await db.run("UPDATE index_meta SET views_hash = $hash", { hash: viewsFingerprint });
  }

  // Clear the per-host indexing variable so a query reusing this connection without
  // an explicit host param spans all hosts rather than inheriting the last one.
  await db.run("SET VARIABLE host = NULL");
  lap("views");

  // Without an explicit CHECKPOINT the blocks freed by DELETE+INSERT and the
  // content_items rebuild are never reused and the file grows on every import.
  if (wrote || viewsChanged || telemetryChanged > 0) {
    await db.run("CHECKPOINT");
  }
  lap("checkpoint");

  return {
    corpusBytes,
    changedFiles,
    removedFiles,
    fieldsNew: Number(fields.added),
    fieldsGone: Number(fields.removed),
    phasesMs,
  };
}

// Rewrites the database into a fresh file and swaps it in place. DuckDB never
// returns file space to the OS, so a file bloated by past full-table rewrites
// only shrinks via a copy into a new file.
export async function compactDatabase(dataDir: string): Promise<void> {
  const dbPath = sessionDbPath(dataDir);
  const newPath = `${dbPath}.new`;
  await rm(newPath, { force: true });
  await rm(`${newPath}.wal`, { force: true });

  const db = await createDatabase(dbPath);
  try {
    await db.run(
      `ATTACH '${newPath.replaceAll("'", "''")}' AS compacted (STORAGE_VERSION '${STORAGE_VERSION}')`,
    );
    await db.run("COPY FROM DATABASE session TO compacted");
    await db.run("DETACH compacted");
  } finally {
    db.close();
  }

  await $`mv ${newPath} ${dbPath}`.quiet();
  await rm(`${dbPath}.wal`, { force: true });
  await rm(`${newPath}.wal`, { force: true });
}

export async function runQuery<T>(
  db: Database,
  queryName: string,
  schema: z.ZodType<T>,
  params: Record<string, string | null> = {},
): Promise<T[]> {
  return runOnAdapter(nodeAdapter(db), { name: queryName }, schema, params);
}
