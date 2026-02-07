import { runJxa as _runJxa } from "run-jxa";
import type { JsonValue } from "type-fest";

const enabled = process.env.DEBUG === "1";

export function debug(message: string): void {
  if (!enabled) return;
  console.error(`[things] ${message}`);
}

export async function runJxa<R extends JsonValue, A extends readonly JsonValue[]>(
  fn: (...args: A) => R,
  args?: A,
): Promise<R> {
  debug("runJxa...");
  const start = performance.now();
  const result = await _runJxa(fn, args);
  const ms = (performance.now() - start).toFixed(0);
  debug(`runJxa: ${ms}ms`);
  return result;
}
