import type { z } from "zod";
import { DispatchError, type DispatchRecord } from "./record";
import type { CommandResult, Runner, RunOptions } from "./runner";

export function decode<T>(
  schema: z.ZodType<T>,
  result: CommandResult,
  label: string,
  partial: DispatchRecord | null,
): T {
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new DispatchError(
      `${label} did not return JSON: ${result.stdout.slice(0, 200)}`,
      partial,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new DispatchError(
      `${label} returned an unexpected shape: ${parsed.error.message}`,
      partial,
    );
  return parsed.data;
}

export async function required(
  run: Runner,
  argv: readonly string[],
  partial: DispatchRecord | null,
  options?: RunOptions,
): Promise<CommandResult> {
  const result = await run(argv, options);
  if (result.code !== 0)
    throw new DispatchError(
      result.stderr.trim() === "" ? `${argv.join(" ")} exited ${result.code}` : result.stderr,
      partial,
    );
  return result;
}

export async function requiredJson<T>(
  run: Runner,
  argv: readonly string[],
  schema: z.ZodType<T>,
  partial: DispatchRecord | null,
): Promise<T> {
  return decode(schema, await required(run, argv, partial), argv.slice(0, 3).join(" "), partial);
}
