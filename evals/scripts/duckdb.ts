import { z } from "zod";
import { decodeJson } from "../../packages/decode/index";
import { expectSuccess, type RunCommand, runCommand } from "./command";

/** A single-quoted SQL string literal. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function timestampLiteral(value: Date): string {
  return `TIMESTAMP ${literal(value.toISOString().replace("T", " ").slice(0, 19))}`;
}

/**
 * Runs SQL through the `duckdb` CLI and validates the rows of its final statement.
 * The corpus is a directory of JSON files rather than a persistent database, so an
 * in-memory session per query needs no lock coordination.
 */
export async function query<S extends z.ZodType>(
  sql: string,
  schema: S,
  run: RunCommand = runCommand,
): Promise<z.output<S>[]> {
  const command = ["duckdb", "-json", "-c", sql];
  const result = expectSuccess(command, await run(command));
  const text = result.stdout.trim();
  if (text === "") return [];
  return decodeJson(z.array(schema), text, "duckdb -json output");
}
