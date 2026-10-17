import { globSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { calls } from "./trace";

/**
 * For each `<case>/<arm>`, how many runs made each call at least once, and the run total.
 * Each result is a results directory or the `aggregate-result.json` inside one, as
 * `compare.ts` takes it. Throws when a result holds no traces, which would otherwise read as
 * no session making the call.
 */
export async function tally(
  results: string[],
): Promise<Map<string, { runs: number; calls: Map<string, number> }>> {
  const traces = results.flatMap((result) => {
    const dir = result.endsWith(".json") ? dirname(result) : result;
    const found = globSync("traces/*.jsonl", { cwd: dir }).map((t) => join(dir, t));
    if (found.length === 0) throw new Error(`No traces/*.jsonl in ${dir}`);
    return found;
  });
  const out = new Map<string, { runs: number; calls: Map<string, number> }>();
  const read = await Promise.all(traces.map(async (t) => [t, await Bun.file(t).text()] as const));
  for (const [path, text] of read) {
    const match = /^(.+)-(with|without)-\d+\.jsonl$/.exec(basename(path));
    if (match === null) continue;
    const key = `${match[1]}/${match[2]}`;
    const cell = out.get(key) ?? { runs: 0, calls: new Map<string, number>() };
    cell.runs += 1;
    for (const call of new Set(calls(text))) cell.calls.set(call, (cell.calls.get(call) ?? 0) + 1);
    out.set(key, cell);
  }
  return out;
}
