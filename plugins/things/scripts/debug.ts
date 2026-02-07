import { runJxa as _runJxa } from "run-jxa";

const enabled = process.env.DEBUG === "1";

export function debug(message: string): void {
  if (!enabled) return;
  console.error(`[things] ${message}`);
}

export const runJxa: typeof _runJxa = async (fn, args?) => {
  debug("runJxa...");
  const start = performance.now();
  const result = await _runJxa(fn, args);
  const ms = (performance.now() - start).toFixed(0);
  debug(`runJxa: ${ms}ms`);
  return result;
};
