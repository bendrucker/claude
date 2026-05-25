import { readdirSync } from "node:fs";
import * as path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const RESOURCES_DIR = path.join(import.meta.dirname, "..", "resources");
const SCHEMA_DIR = path.join(RESOURCES_DIR, "schema");
const QUERIES_DIR = path.join(RESOURCES_DIR, "queries");

export interface Database {
  run(sql: string, params?: Record<string, string | null>): Promise<void>;
  query<T>(sql: string, params?: Record<string, string | null>): Promise<T[]>;
  close(): void;
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

function getProjectsGlob(projectsDir?: string): string {
  const dir = projectsDir || process.env.CLAUDE_PROJECTS_DIR;
  if (dir) return path.join(dir, "**", "*.jsonl");

  if (!process.env.HOME) {
    throw new Error("Cannot locate projects directory: set CLAUDE_PROJECTS_DIR or HOME");
  }
  return path.join(process.env.HOME, ".claude", "projects", "**", "*.jsonl");
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

async function migrateIfNeeded(db: Database): Promise<void> {
  const [row] = await db.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'main' AND table_name = 'raw' AND column_name = 'data'
    ) AS ok
  `);
  if (row?.ok) return;
  await db.run("DROP TABLE IF EXISTS messages");
  await db.run("DROP TABLE IF EXISTS content_items");
  await db.run("DROP TABLE IF EXISTS raw");
  await db.run("DROP TABLE IF EXISTS meta");
}

export async function getDb(dataDir: string): Promise<Database> {
  const dbPath = path.join(dataDir, "session.duckdb");
  return createDatabase(dbPath);
}

export async function ensureIndex(
  db: Database,
  options: { projectsDir?: string; force?: boolean; dataDir?: string } = {},
): Promise<void> {
  if (!options.force && options.dataDir) {
    const sessionId = process.env.CLAUDE_SESSION_ID;
    if (sessionId) {
      const marker = path.join(options.dataDir, `.refreshed-${sessionId}`);
      if (await Bun.file(marker).exists()) return;
    }
  }

  await migrateIfNeeded(db);
  await applySchema(db);

  const glob = getProjectsGlob(options.projectsDir);

  await db.run("SET VARIABLE projects_glob = $glob", { glob });
  await db.run(await readSql(RESOURCES_DIR, "refresh"));

  const [row] = await db.query<{ n: bigint }>("SELECT LEN(getvariable('changed_files')) as n");
  if (!row || row.n === 0n) return;

  await db.run("SET VARIABLE source = getvariable('changed_files')");
  await db.run(await readSql(RESOURCES_DIR, "import"));
  await db.run(await readSql(RESOURCES_DIR, "views"));

  if (options.dataDir) {
    const sessionId = process.env.CLAUDE_SESSION_ID;
    if (sessionId) {
      await Bun.write(path.join(options.dataDir, `.refreshed-${sessionId}`), "");
    }
  }
}

async function setParams(db: Database, params: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      await db.run(`SET VARIABLE "${key}" = NULL`);
    } else {
      await db.run(`SET VARIABLE "${key}" = $value`, { value });
    }
  }
}

export async function runQuery<T>(
  db: Database,
  queryName: string,
  params: Record<string, string | null> = {},
  queriesDir: string = QUERIES_DIR,
): Promise<T[]> {
  await setParams(db, params);
  const sql = await readSql(queriesDir, queryName);
  return db.query<T>(sql);
}

export async function execQuery(
  db: Database,
  queryName: string,
  params: Record<string, string | null> = {},
  queriesDir: string = QUERIES_DIR,
): Promise<void> {
  await setParams(db, params);
  const sql = await readSql(queriesDir, queryName);
  await db.run(sql);
}
