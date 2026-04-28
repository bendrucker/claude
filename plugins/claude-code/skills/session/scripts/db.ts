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

export async function getDb(dataDir: string): Promise<Database> {
  const dbPath = path.join(dataDir, "session.duckdb");
  return createDatabase(dbPath);
}

export async function ensureIndex(
  db: Database,
  options: { projectsDir?: string; force?: boolean; dataDir?: string } = {},
): Promise<void> {
  await applySchema(db);

  if (!options.force && options.dataDir) {
    const sessionId = process.env.CLAUDE_SESSION_ID;
    if (sessionId) {
      const marker = path.join(options.dataDir, `.refreshed-${sessionId}`);
      if (await Bun.file(marker).exists()) return;
    }
  }

  const glob = getProjectsGlob(options.projectsDir);

  await db.run("SET VARIABLE projects_glob = $glob", { glob });
  await db.run(await readSql(RESOURCES_DIR, "refresh"));

  const [row] = await db.query<{ n: bigint }>("SELECT LEN(getvariable('changed_files')) as n");
  if (!row || row.n === 0n) return;

  const dataDir = options.dataDir;
  if (!dataDir) throw new Error("dataDir is required for import");
  await db.run("SET VARIABLE data_dir = $dir", { dir: dataDir });
  await db.run(await readSql(RESOURCES_DIR, "import"));

  const contentItemsPath = path.join(dataDir, "content_items.jsonl");
  await db.run(
    `COPY content_items_export TO '${contentItemsPath}' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '')`,
  );
  await db.run("DROP TABLE content_items_export");

  await db.run(await readSql(RESOURCES_DIR, "views"));

  if (options.dataDir) {
    const sessionId = process.env.CLAUDE_SESSION_ID;
    if (sessionId) {
      await Bun.write(path.join(options.dataDir, `.refreshed-${sessionId}`), "");
    }
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
