import * as path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const QUERIES_DIR = path.join(import.meta.dirname, "..", "resources", "queries");

export interface Database {
  run(sql: string): Promise<void>;
  query<T>(sql: string): Promise<T[]>;
  setParams(params: QueryParams): Promise<void>;
  close(): void;
}

export interface TextRow {
  session_id: string;
  timestamp: string;
  role: "user" | "assistant";
  model: string | null;
  project_path: string | null;
  text: string;
  raw_text: string;
}

export interface CorrectionRow {
  session_id: string;
  project: string | null;
  assistant_timestamp: string;
  user_timestamp: string;
  assistant_chars: number;
  user_chars: number;
  assistant_snippet: string;
  user_snippet: string;
}

export interface ModelSummaryRow {
  model: string;
  text_items: number;
  messages: number;
  sessions: number;
  total_chars: number;
  avg_chars_per_item: number;
}

export interface QueryParams {
  [key: string]: string | number | undefined;
}

export async function openDb(dbPath: string): Promise<Database> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  return {
    async run(sql: string) {
      await connection.run(sql);
    },
    async query<T>(sql: string): Promise<T[]> {
      const reader = await connection.runAndReadAll(sql);
      return reader.getRowObjectsJS() as T[];
    },
    async setParams(params: QueryParams) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
          await connection.run(`SET VARIABLE "${key}" = NULL`);
        } else {
          await connection.run(`SET VARIABLE "${key}" = $1`, [String(value)]);
        }
      }
    },
    close() {
      try {
        connection.closeSync();
      } catch {}
    },
  };
}

export async function runQuery<T>(
  db: Database,
  queryName: string,
  params: QueryParams = {},
): Promise<T[]> {
  await db.setParams(params);
  const sql = await Bun.file(path.join(QUERIES_DIR, `${queryName}.sql`)).text();
  return db.query<T>(sql);
}

export async function execQuery(
  db: Database,
  queryName: string,
  params: QueryParams = {},
): Promise<void> {
  await db.setParams(params);
  const sql = await Bun.file(path.join(QUERIES_DIR, `${queryName}.sql`)).text();
  for (const stmt of sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    await db.run(stmt);
  }
}

export function serializeCorpus(rows: Array<{ text?: string }>): string {
  return rows
    .map((r) => r.text)
    .filter(Boolean)
    .join("\n\n\f\n\n");
}

export function totalChars(rows: Array<{ text?: string }>): number {
  return rows.reduce((sum, r) => sum + (r.text?.length ?? 0), 0);
}
