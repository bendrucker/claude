import { readdirSync } from "node:fs";
import * as path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const RESOURCES_DIR = path.join(import.meta.dirname, "..", "resources");
const SCHEMA_DIR = path.join(RESOURCES_DIR, "schema");
const QUERIES_DIR = path.join(RESOURCES_DIR, "queries");

export const LOCAL_HOST = "local";

// Bump when the ingestion logic changes in a way that requires re-reading every
// JSONL line (not just newly-modified files). migrateIfNeeded drops the cache when
// the stored version is older. v2: raw ingests all record types, not just chat.
export const INDEX_VERSION = 2;

export interface Database {
  run(sql: string, params?: Record<string, string | null>): Promise<void>;
  query<T>(sql: string, params?: Record<string, string | null>): Promise<T[]>;
  close(): void;
}

export interface HostPolicy {
  block_egress?: boolean;
}

export interface Manifest {
  host: string;
  source: string;
  imported_at: string;
  policy: HostPolicy;
}

export interface HostEntry {
  host: string;
  glob: string;
  policy: HostPolicy;
}

async function createDatabase(dbPath: string): Promise<Database> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  return {
    async run(sql, params = {}) {
      await connection.run(sql, params);
    },

    async query<T>(sql: string, params: Record<string, string | null> = {}): Promise<T[]> {
      const reader = await connection.runAndReadAll(sql, params);
      return reader.getRowObjectsJS() as T[];
    },

    close() {
      try {
        connection.closeSync();
      } catch (err) {
        console.error("Failed to close DuckDB connection:", err);
      }
    },
  };
}

async function readSql(dir: string, name: string): Promise<string> {
  return Bun.file(path.join(dir, `${name}.sql`)).text();
}

function getLocalGlob(projectsDir?: string): string {
  const dir = projectsDir || process.env.CLAUDE_PROJECTS_DIR;
  if (dir) return path.join(dir, "**", "*.jsonl");

  if (!process.env.HOME) {
    throw new Error("Cannot locate projects directory: set CLAUDE_PROJECTS_DIR or HOME");
  }
  return path.join(process.env.HOME, ".claude", "projects", "**", "*.jsonl");
}

export function getImportsDir(importsDir?: string): string {
  const dir = importsDir || process.env.CLAUDE_SESSION_IMPORTS_DIR;
  if (dir) return dir;

  if (!process.env.HOME) {
    throw new Error("Cannot locate imports directory: set CLAUDE_SESSION_IMPORTS_DIR or HOME");
  }
  return path.join(process.env.HOME, ".claude", "session-imports");
}

export function importRoot(label: string, importsDir?: string): string {
  return path.join(getImportsDir(importsDir), label);
}

export function getDataDir(): string {
  return (
    process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.TMPDIR || "/tmp", "claude-session")
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
      const manifest: unknown = await Bun.file(manifestPath).json();
      hosts.push({
        label: entry.name,
        root: hostRoot,
        manifestPath,
        manifest: manifest as Manifest,
      });
    } catch {
      // No manifest (or invalid JSON) means this directory is not a registered host.
    }
  }
  return hosts;
}

export async function enumerateHosts(
  options: { projectsDir?: string; importsDir?: string } = {},
): Promise<HostEntry[]> {
  const hosts: HostEntry[] = [
    { host: LOCAL_HOST, glob: getLocalGlob(options.projectsDir), policy: {} },
  ];

  for (const imported of await listImportedHosts(options.importsDir)) {
    // The directory name is the canonical label (forget.ts/hosts.ts/importRoot all
    // key on it); the manifest's host field is informational and may be hand-edited.
    hosts.push({
      host: imported.label,
      glob: path.join(imported.root, "projects", "**", "*.jsonl"),
      policy: imported.manifest.policy ?? {},
    });
  }

  return hosts;
}

async function applySchema(db: Database): Promise<void> {
  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await Bun.file(path.join(SCHEMA_DIR, file)).text();
    await db.run(sql);
  }
}

async function dropCache(db: Database): Promise<void> {
  await db.run("DROP TABLE IF EXISTS content_items");
  await db.run("DROP TABLE IF EXISTS raw");
  await db.run("DROP TABLE IF EXISTS meta");
  await db.run("DROP TABLE IF EXISTS index_meta");
}

async function migrateIfNeeded(db: Database): Promise<void> {
  const [row] = await db.query<{ has_data: boolean; has_host: boolean; has_version: boolean }>(`
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
  `);
  // Querying index_meta is only safe once the table exists.
  const version = row?.has_version
    ? Number(
        (
          await db.query<{ version: number }>(
            "SELECT COALESCE(MAX(version), 0) AS version FROM index_meta",
          )
        )[0]?.version ?? 0,
      )
    : 0;
  // A pre-host schema (missing data/host) or an older ingestion version both mean
  // the cache predates the current import logic; drop it so the next run rebuilds.
  if (row?.has_data && row?.has_host && version >= INDEX_VERSION) return;
  await dropCache(db);
}

export async function getDb(dataDir: string): Promise<Database> {
  return createDatabase(sessionDbPath(dataDir));
}

export async function ensureSchema(db: Database): Promise<void> {
  await migrateIfNeeded(db);
  await applySchema(db);
  await db.run("DELETE FROM index_meta");
  await db.run(`INSERT INTO index_meta VALUES (${INDEX_VERSION})`);
}

export async function rebuildViews(db: Database): Promise<void> {
  await db.run(await readSql(RESOURCES_DIR, "views"));
}

export async function ensureIndex(
  db: Database,
  options: { projectsDir?: string; importsDir?: string; force?: boolean; dataDir?: string } = {},
): Promise<void> {
  const sessionId = process.env.CLAUDE_SESSION_ID;
  const marker =
    options.dataDir && sessionId
      ? path.join(options.dataDir, `.refreshed-${sessionId}`)
      : undefined;

  if (!options.force && marker && (await Bun.file(marker).exists())) return;

  await ensureSchema(db);

  let imported = false;
  for (const entry of await enumerateHosts(options)) {
    await db.run("SET VARIABLE host = $host", { host: entry.host });
    await db.run("SET VARIABLE projects_glob = $glob", { glob: entry.glob });
    await db.run(await readSql(RESOURCES_DIR, "refresh"));

    const [row] = await db.query<{ n: bigint }>("SELECT LEN(getvariable('changed_files')) as n");
    if (!row || row.n === 0n) continue;

    await db.run("SET VARIABLE source = getvariable('changed_files')");
    await db.run(await readSql(RESOURCES_DIR, "import"));
    imported = true;
  }

  if (imported) {
    await rebuildViews(db);
  }

  // Clear the per-host indexing variable so a query reusing this connection without
  // an explicit host param spans all hosts rather than inheriting the last one.
  await db.run("SET VARIABLE host = NULL");

  if (marker) {
    await Bun.write(marker, "");
  }
}

export async function runQuery<T>(
  db: Database,
  queryName: string,
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
  return db.query<T>(sql);
}
