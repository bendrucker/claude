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

// Bump when the ingestion logic changes in a way that requires re-reading every
// JSONL line (not just newly-modified files). migrateIfNeeded drops the cache when
// the stored version is older. v2: raw ingests all record types, not just chat.
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
  const hosts: ImportedHost[] = [];
  for (const entry of readDirEntries(root)) {
    if (!entry.isDirectory()) continue;
    const hostRoot = path.join(root, entry.name);
    const manifestPath = path.join(hostRoot, "manifest.json");
    try {
      hosts.push({
        label: entry.name,
        root: hostRoot,
        manifestPath,
        manifest: Manifest.parse(await Bun.file(manifestPath).json()),
      });
    } catch {
      // A missing or undecodable manifest means this directory is not a registered host.
    }
  }
  return hosts;
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
    const sql = await Bun.file(path.join(SCHEMA_DIR, file)).text();
    await db.run(sql);
  }
}

async function dropCache(db: Database): Promise<void> {
  await db.run("DROP TABLE IF EXISTS content_items");
  await db.run("DROP TABLE IF EXISTS raw");
  await db.run("DROP TABLE IF EXISTS indexed_files");
  await db.run("DROP TABLE IF EXISTS meta");
  await db.run("DROP TABLE IF EXISTS index_meta");
}

async function migrateIfNeeded(db: Database): Promise<void> {
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
  // Querying index_meta is only safe once the table exists.
  const version = row?.has_version
    ? ((
        await db.query(
          "SELECT COALESCE(MAX(version), 0) AS version FROM index_meta",
          z.object({ version: z.number() }),
        )
      )[0]?.version ?? 0)
    : 0;
  // A pre-host schema (missing data/host) or an older ingestion version both mean
  // the cache predates the current import logic; drop it so the next run rebuilds.
  if (row?.has_data && row.has_host && version >= INDEX_VERSION) return;
  await dropCache(db);
}

export async function getDb(dataDir: string): Promise<Database> {
  return createDatabase(sessionDbPath(dataDir));
}

export async function ensureSchema(db: Database): Promise<void> {
  await migrateIfNeeded(db);
  await applySchema(db);
  const [row] = await db.query("SELECT COUNT(*) AS n FROM index_meta", z.object({ n: z.bigint() }));
  if (!row || row.n === 0n) {
    await db.run(`INSERT INTO index_meta VALUES (${INDEX_VERSION}, NULL)`);
  }
}

export async function rebuildViews(db: Database): Promise<void> {
  await db.run(await readSql(RESOURCES_DIR, "views"));
}

async function viewsFingerprint(): Promise<string> {
  const sql = await readSql(RESOURCES_DIR, "views");
  return new Bun.CryptoHasher("sha256").update(sql).digest("hex");
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
  await ensureSchema(db);

  const importSql = await readSql(RESOURCES_DIR, "import");
  let corpusBytes = 0;
  let changedFiles = 0;
  let removedFiles = 0;

  for (const entry of await enumerateHosts(options)) {
    // A missing root is a transient or misconfigured mount (or a typo'd
    // CLAUDE_PROJECTS_DIR), never "every file was deleted": skip the host
    // rather than dropping all its rows. forget.ts deletes rows explicitly.
    if (!dirExists(entry.root)) continue;
    const scanned = scanJsonlFiles(entry.root);
    corpusBytes += scanned.reduce((sum, f) => sum + f.size, 0);

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

    await db.run("SET VARIABLE host = $host", { host: entry.host });
    for (const file of changed) {
      await db.run("SET VARIABLE source_path = $path", { path: file.path });
      await db.run("SET VARIABLE source_mtime = $mtime", { mtime: String(file.mtime) });
      await db.run("SET VARIABLE source_size = $size", { size: String(file.size) });
      await db.run(importSql);
    }
    for (const file of removed) {
      await removeFile(db, entry.host, file.path);
    }

    if (changed.length > 0 || removed.length > 0) {
      await db.run("DELETE FROM meta WHERE host = $host", { host: entry.host });
      await db.run("INSERT INTO meta VALUES ($host, CURRENT_TIMESTAMP)", { host: entry.host });
    }
    changedFiles += changed.length;
    removedFiles += removed.length;
  }

  // Rebuild when raw changed (views.sql rebuilds the content_items table, whose
  // cross-file dedup cannot be maintained per-file) or when views.sql itself was
  // edited, so a definition change applies even on a no-change refresh.
  const wrote = changedFiles > 0 || removedFiles > 0;
  const fingerprint = await viewsFingerprint();
  const [metaRow] = await db.query(
    "SELECT views_hash FROM index_meta",
    z.object({ views_hash: z.string().nullable() }),
  );
  const viewsChanged = metaRow?.views_hash !== fingerprint;
  if (wrote || viewsChanged) {
    await rebuildViews(db);
    await db.run("UPDATE index_meta SET views_hash = $hash", { hash: fingerprint });
  }

  // Clear the per-host indexing variable so a query reusing this connection without
  // an explicit host param spans all hosts rather than inheriting the last one.
  await db.run("SET VARIABLE host = NULL");

  // Without an explicit CHECKPOINT the blocks freed by DELETE+INSERT and the
  // content_items rebuild are never reused and the file grows on every import.
  if (wrote || viewsChanged) {
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
      await db.run(`SET VARIABLE "${key}" = NULL`);
    } else {
      await db.run(`SET VARIABLE "${key}" = $value`, { value });
    }
  }
  const sql = await readSql(QUERIES_DIR, queryName);
  return db.query(sql, schema);
}
