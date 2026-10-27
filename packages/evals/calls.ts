import type { Adapter } from "./adapter";
import { native } from "./adapters/native";

/**
 * For each `<case>/<arm>`, how many runs made each call at least once, and the run total,
 * pooled across stored results.
 */
export async function tally(
  results: string[],
  adapter: Adapter = native,
): Promise<Map<string, { runs: number; calls: Map<string, number> }>> {
  const out = new Map<string, { runs: number; calls: Map<string, number> }>();
  for (const cells of await Promise.all(results.map((r) => adapter.traces(r))))
    for (const [key, transcripts] of cells) {
      const cell = out.get(key) ?? { runs: 0, calls: new Map<string, number>() };
      for (const t of Object.values(transcripts)) {
        cell.runs += 1;
        for (const call of new Set(t.calls)) cell.calls.set(call, (cell.calls.get(call) ?? 0) + 1);
      }
      out.set(key, cell);
    }
  return out;
}
