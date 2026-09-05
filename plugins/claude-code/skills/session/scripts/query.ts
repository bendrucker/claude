import { join } from "node:path";
import { z } from "zod";
import type { Database } from "./db";

const QUERIES_DIR = join(import.meta.dirname, "..", "resources", "queries");

export type QueryValue = string | number | null | undefined;

// undefined leaves the variable unset (getvariable returns NULL); null sets it to NULL
// explicitly, which callers reusing a connection need to clear a previous value.
export type QueryParams = Record<string, QueryValue>;

// A named file under resources/queries, or literal SQL.
export type QuerySource = { name: string } | { sql: string };

export interface QueryAdapter {
  // Applies the params and returns SQL to prepend to the query.
  bind(params: QueryParams): Promise<string>;
  execute<T>(sql: string, schema: z.ZodType<T>): Promise<T[]>;
}

export function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot bind non-finite number: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

// Which params become variables, and under what name, for both adapters. The key is
// quoted as a SQL identifier, which no parameter binding covers.
function* bindings(params: QueryParams): Generator<[string, string | number | null]> {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid query parameter name: ${key}`);
    }
    yield [key, value];
  }
}

export function renderSetVariables(params: QueryParams): string {
  const lines: string[] = [];
  for (const [name, value] of bindings(params)) {
    lines.push(`SET VARIABLE "${name}" = ${sqlLiteral(value)};`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function nodeAdapter(db: Database): QueryAdapter {
  return {
    async bind(params) {
      for (const [name, value] of bindings(params)) {
        if (typeof value === "string") {
          // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the query reads back.
          await db.run(`SET VARIABLE "${name}" = $value`, { value });
        } else {
          // oxlint-disable-next-line no-await-in-loop -- SET VARIABLE is connection-global state the query reads back.
          await db.run(`SET VARIABLE "${name}" = ${sqlLiteral(value)}`);
        }
      }
      return "";
    },

    execute(sql, schema) {
      return db.query(sql, schema);
    },
  };
}

export interface QueryProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type SpawnDuckdb = (
  command: string[],
  options: { stdin: Buffer; signal: AbortSignal },
) => QueryProcess;

const spawnDuckdb: SpawnDuckdb = (command, options) =>
  Bun.spawn(command, { ...options, stdout: "pipe", stderr: "pipe" });

// A hang guard, not a latency budget: a large corpus can legitimately take a while.
// schema.ts overrides it with the tighter budget its load path needs.
export const CLI_TIMEOUT_MS = 120_000;

export interface CliOptions {
  timeoutMs?: number;
  spawn?: SpawnDuckdb;
}

// Reads through the duckdb CLI so a query takes a shared read-only lock instead of
// contending for the exclusive write lock a concurrent refresh holds.
export function cliAdapter(dbPath: string, options: CliOptions = {}): QueryAdapter {
  const { timeoutMs = CLI_TIMEOUT_MS, spawn = spawnDuckdb } = options;

  return {
    bind(params) {
      return Promise.resolve(renderSetVariables(params));
    },

    async execute(sql, schema) {
      const signal = AbortSignal.timeout(timeoutMs);
      const proc = spawn(["duckdb", "-readonly", "-json", dbPath], {
        stdin: Buffer.from(sql),
        signal,
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (signal.aborted) throw new Error(`duckdb timed out after ${timeoutMs}ms`);
      if (code !== 0) {
        const detail = err.trim();
        throw new Error(detail !== "" ? detail : `duckdb exited ${code}`);
      }

      const rows = out.trim();
      return z.array(schema).parse(JSON.parse(rows !== "" ? rows : "[]"));
    },
  };
}

export async function runQuery<T>(
  adapter: QueryAdapter,
  source: QuerySource,
  schema: z.ZodType<T>,
  params: QueryParams = {},
): Promise<T[]> {
  const sql =
    "name" in source ? await Bun.file(join(QUERIES_DIR, `${source.name}.sql`)).text() : source.sql;
  const prefix = await adapter.bind(params);
  return adapter.execute(prefix + sql, schema);
}
