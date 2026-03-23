import * as fs from "node:fs";
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

function readSql(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, `${name}.sql`), "utf-8");
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
  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(SCHEMA_DIR, file), "utf-8");
    await db.run(sql);
  }
}

async function hasData(db: Database): Promise<boolean> {
  const rows = await db.query<{ last_import: Date }>("SELECT last_import FROM meta LIMIT 1");
  return rows.length > 0;
}

export async function getDb(dataDir: string): Promise<Database> {
  const dbPath = path.join(dataDir, "session.duckdb");
  return createDatabase(dbPath);
}

export async function ensureIndex(db: Database, projectsDir?: string): Promise<void> {
  const glob = getProjectsGlob(projectsDir);

  await applySchema(db);

  const importSql = readSql(RESOURCES_DIR, "import");

  await db.run("SET VARIABLE projects_glob = $glob", { glob });

  if (await hasData(db)) {
    await db.run(readSql(RESOURCES_DIR, "refresh"));

    const [row] = await db.query<{ n: bigint }>("SELECT LEN(getvariable('changed_files')) as n");
    if (!row || row.n === 0n) return;

    await db.run("SET VARIABLE source = getvariable('changed_files')");
  } else {
    await db.run("SET VARIABLE source = getvariable('projects_glob')");
  }

  await db.run(importSql);
}

export async function runQuery<T>(
  db: Database,
  queryName: string,
  params: Record<string, string | null> = {},
): Promise<T[]> {
  const sql = readSql(QUERIES_DIR, queryName);
  return db.query<T>(sql, params);
}
