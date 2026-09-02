import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { $ } from "bun";
import { z } from "zod";

const RESOURCES_DIR = path.join(import.meta.dirname, "..", "resources");
const SCHEMA_DIR = path.join(RESOURCES_DIR, "schema");
const QUERIES_DIR = path.join(RESOURCES_DIR, "queries");

export const LOCAL_HOST = "local";

// Bump only when the scan or a row's file identity changes (source_file, source_line):
// those come from the scan rather than from the line, so they are the one thing a
// re-read restores. Everything else about a row is a projection of raw.data and is
// re-derived in place by reconcilePinned, and content_items rebuilds from raw whenever
// views.sql changes, so neither needs a bump. migrateIfNeeded clears indexed_files when
// the stored version is older, re-importing every file still on disk while leaving rows
// whose file is gone in place. v2: raw ingests all record types, not just chat.
// v3: per-file change catalog (indexed_files), incremental content_items.
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

async function createDatabase(dbPath: string): Promise<Database> {
  const instance = await DuckDBInstance.create(dbPath);
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
      } catch (err) {
        console.error("Failed to close DuckDB connection:", err);
      }
      try {
        instance.closeSync();
      } catch (err) {
        console.error("Failed to close DuckDB instance:", err);
      }
    },
  };
}

async function readSql(dir: string, name: string): Promise<string> {
  return Bun.file(path.join(dir, `${name}.sql`)).text();
}

function getLocalRoot(projectsDir?: string): string {
  const dir = projectsDir ?? process.env.CLAUDE_PROJECTS_DIR;
  if (dir != null && dir !== "") return dir;

  if (process.env.HOME == null || process.env.HOME === "") {
    throw new Error("Cannot locate projects directory: set CLAUDE_PROJECTS_DIR or HOME");
  }
  return path.join(process.env.HOME, ".claude", "projects");
}

export function getImportsDir(importsDir?: string): string {
  const dir = importsDir ?? process.env.CLAUDE_SESSION_IMPORTS_DIR;
  if (dir != null && dir !== "") return dir;

  if (process.env.HOME == null || process.env.HOME === "") {
    throw new Error("Cannot locate imports directory: set CLAUDE_SESSION_IMPORTS_DIR or HOME");
  }
  return path.join(process.env.HOME, ".claude", "session-imports");
}

export function importRoot(label: string, importsDir?: string): string {
  return path.join(getImportsDir(importsDir), label);
}

// The ${CLAUDE_PLUGIN_DATA} template expands only in skill text and hook/MCP
// subprocesses, never in Bash tool shells, so the scripts resolve the dir from
// their own installed location: cache/<marketplace>/<plugin>/<hash>/... maps to
// data/<plugin>-<marketplace>/. The env var remains as an override (tests,
// hooks, dev checkouts).
export function getDataDir(): string {
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;

  const segments = import.meta.dirname.split(path.sep);
  const cacheIdx = segments.lastIndexOf("cache");
  if (cacheIdx > 0 && segments[cacheIdx - 1] === "plugins" && segments.length > cacheIdx + 2) {
    const marketplace = segments[cacheIdx + 1];
    const plugin = segments[cacheIdx + 2];
    const pluginsDir = segments.slice(0, cacheIdx).join(path.sep);
    return path.join(pluginsDir, "data", `${plugin}-${marketplace}`);
  }

  throw new Error(
    "Cannot locate plugin data directory: not running from an installed plugin. Set CLAUDE_PLUGIN_DATA.",
  );
}

export function sessionDbPath(dataDir: string): string {
  return path.join(dataDir, "session.duckdb");
}

export function dirExists(target: string): boolean {
  try {
    readdirSync(target);
    return true;
  } catch {
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
  } catch {
    return [];
  }
}

export async function listImportedHosts(importsDir?: string): Promise<ImportedHost[]> {
  const root = getImportsDir(importsDir);
  const read = await Promise.all(
    readDirEntries(root)
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const hostRoot = path.join(root, entry.name);
        const manifestPath = path.join(hostRoot, "manifest.json");
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
      root: path.join(imported.root, "projects"),
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
    const full = path.join(entry.parentPath, entry.name);
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
    const sql = await Bun.file(path.join(SCHEMA_DIR, file)).text();
    // oxlint-disable-next-line no-await-in-loop -- schema files apply in sorted order; later DDL depends on tables earlier DDL created.
    await db.run(sql);
  }
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
  const [row] = await db.query(
    "SELECT import_hash FROM index_meta",
    z.object({ import_hash: z.string().nullable() }),
  );
  if (row?.import_hash === fingerprint) return false;

  // A null hash is an index built before this check existed. The projection may have
  // changed between that build and the first run to stamp it, so the rewrite is skipped
  // only when raw's columns already match what the projection produces.
  const seeding = row?.import_hash == null;
  const rewrite = !seeding || !(await rawMatchesProjection(db));

  // Derived state is invalidated either way. An adopted index was built by code that
  // could leave content_items behind a committed import, and its provenance is not
  // recoverable, so the run that adopts it rebuilds once rather than inheriting the
  // question.
  await invalidateDerived(db);
  if (rewrite) {
    await db.run(`
      CREATE OR REPLACE TABLE raw AS
      SELECT host, UNNEST(pinned_columns(data)), source_file, source_line, data FROM raw
    `);
    await db.run("CHECKPOINT");
  }
  await db.run("UPDATE index_meta SET import_hash = $hash", { hash: fingerprint });
  return rewrite;
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
  if (!row || row.n === 0n) {
    await db.run(`INSERT INTO index_meta VALUES (${INDEX_VERSION}, NULL, NULL)`);
  } else {
    await db.run(`UPDATE index_meta SET version = ${INDEX_VERSION}`);
  }
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
}

export async function ensureIndex(
  db: Database,
  options: { projectsDir?: string; importsDir?: string } = {},
): Promise<IndexResult> {
  const pinnedRederived = await ensureSchema(db);

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
      z.object({ path: z.string(), mtime: z.bigint(), size: z.bigint() }),
      { host: entry.host },
    );
    const indexedByPath = new Map(indexed.map((r) => [r.path, r]));
    const scannedPaths = new Set(scanned.map((f) => f.path));

    const changed = scanned.filter((f) => {
      const prev = indexedByPath.get(f.path);
      return !prev || Number(prev.mtime) !== f.mtime || Number(prev.size) !== f.size;
    });
    const removed = indexed.filter((r) => !scannedPaths.has(r.path));

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
  }

  // views_hash answers both "was views.sql edited" and "did raw change", because every
  // mutation clears it before writing. So it also covers a run that died partway: the
  // fingerprint it finds is null and the rebuild happens now.
  const wrote = changedFiles > 0 || removedFiles > 0 || pinnedRederived;
  const fingerprint = await fileFingerprint(RESOURCES_DIR, "views");
  const [metaRow] = await db.query(
    "SELECT views_hash FROM index_meta",
    z.object({ views_hash: z.string().nullable() }),
  );
  const viewsChanged = metaRow?.views_hash !== fingerprint;
  // The one path that clears no fingerprint is an INDEX_VERSION bump against an empty
  // corpus, which drops content_items and then imports no file. Asking whether the table
  // is there covers it.
  const derivedMissing = !(await tableExists(db, "content_items"));
  if (wrote || viewsChanged || derivedMissing) {
    await rebuildViews(db);
    await db.run("UPDATE index_meta SET views_hash = $hash", { hash: fingerprint });
  }

  // Clear the per-host indexing variable so a query reusing this connection without
  // an explicit host param spans all hosts rather than inheriting the last one.
  await db.run("SET VARIABLE host = NULL");

  // Without an explicit CHECKPOINT the blocks freed by DELETE+INSERT and the
  // content_items rebuild are never reused and the file grows on every import.
  if (wrote || viewsChanged || derivedMissing) {
    await db.run("CHECKPOINT");
  }

  return { corpusBytes, changedFiles, removedFiles };
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
    await db.run(`ATTACH '${newPath.replaceAll("'", "''")}' AS compacted`);
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
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the query below reads back.
      await db.run(`SET VARIABLE "${key}" = NULL`);
    } else {
      // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the query below reads back.
      await db.run(`SET VARIABLE "${key}" = $value`, { value });
    }
  }
  const sql = await readSql(QUERIES_DIR, queryName);
  return db.query(sql, schema);
}
