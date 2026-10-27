import { basename, dirname, join } from "node:path";
import type { Adapter } from "../adapter";
import { readResult } from "../result";
import { type Measured, traceMeasures } from "../trace";

async function measure(path: string): Promise<Measured> {
  const file = Bun.file(path);
  return (await file.exists()) ? traceMeasures(await file.text()) : {};
}

/** Reads an `aggregate-result.json` and the `traces/` beside it. */
export const native: Adapter = {
  name: "native",
  async read(path) {
    const result = await readResult(path);
    const traces = join(dirname(path), "traces");
    const keyed = result.cases.flatMap((c) =>
      Object.entries(c.arms).map(async ([arm, runs]) => {
        const measured = await Promise.all(
          runs.map((_, i) => measure(join(traces, `${c.name}-${arm}-${i}.jsonl`))),
        );
        return [`${c.name}/${arm}`, measured] as const;
      }),
    );
    return { result, measured: new Map(await Promise.all(keyed)) };
  },
  label: (path) => basename(dirname(path)),
};
