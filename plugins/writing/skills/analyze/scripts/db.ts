import * as path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const QUERIES_DIR = path.join(import.meta.dirname, "..", "resources", "queries");

export interface Database {
  run(sql: string): Promise<void>;
  query<T>(sql: string): Promise<T[]>;
  setParams(params: Record<string, string | null>): Promise<void>;
  runQuery<T>(queryName: string, params?: Record<string, string | null>): Promise<T[]>;
  execQuery(queryName: string, params?: Record<string, string | null>): Promise<void>;
  close(): void;
}

export async function openSessionDb(dbPath: string): Promise<Database> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  async function run(sql: string): Promise<void> {
    await connection.run(sql);
  }

  async function query<T>(sql: string): Promise<T[]> {
    const reader = await connection.runAndReadAll(sql);
    const rows = reader.getRowObjectsJS();
    return rows.map(narrowBigints) as T[];
  }

  async function setParams(params: Record<string, string | null>): Promise<void> {
    for (const [key, value] of Object.entries(params)) {
      if (value === null) {
        await connection.run(`SET VARIABLE "${key}" = NULL`);
      } else {
        await connection.run(`SET VARIABLE "${key}" = $value`, { value });
      }
    }
  }

  return {
    run,
    query,
    setParams,

    async runQuery<T>(queryName: string, params: Record<string, string | null> = {}): Promise<T[]> {
      await setParams(params);
      const sql = await readSql(queryName);
      return query<T>(sql);
    },

    async execQuery(queryName: string, params: Record<string, string | null> = {}): Promise<void> {
      await setParams(params);
      const sql = await readSql(queryName);
      for (const stmt of splitStatements(sql)) {
        await connection.run(stmt);
      }
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

async function readSql(name: string): Promise<string> {
  return Bun.file(path.join(QUERIES_DIR, `${name}.sql`)).text();
}

function narrowBigints(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "bigint") {
      if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
        throw new RangeError(`Column "${key}" value ${value} exceeds safe integer range`);
      }
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
