import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import type { Adapter, Transcript } from "../../../../../../../packages/evals/adapter";
import type { Loaded } from "../../../../../../../packages/evals/column";

/** The slice of a serialized pydantic-evals `EvaluationReport` the adapter reads. */
const Report = z.object({
  name: z.string(),
  cases: z.array(
    z.object({
      source_case_name: z.string(),
      output: z.string(),
      assertions: z.record(z.string(), z.object({ value: z.boolean() })),
    }),
  ),
});
type Report = z.output<typeof Report>;
type Arms = Loaded["result"]["cases"][number]["arms"];

/** One report per variant, named for its experiment, which is the arm. */
async function reports(dir: string): Promise<Report[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => Report.parse(await Bun.file(join(dir, f)).json())));
}

export const adapter: Adapter = {
  name: "pydantic-evals",

  async run(suite, { ref, args }) {
    const dir = mkdtempSync(join(tmpdir(), "pydantic-run-"));
    const checkout = join(dir, "checkout");
    await $`mkdir ${checkout}`.quiet();
    await (
      ref === undefined
        ? $`cp -R ${suite}/. ${checkout}`
        : $`git archive ${ref} | tar -x -C ${checkout}`.cwd(suite)
    ).quiet();
    const out = join(dir, "reports");
    await $`uv run --with pydantic-evals --with pydantic-ai python run_evals.py --out ${out} ${args}`
      .cwd(checkout)
      .quiet();
    return out;
  },

  async read(path): Promise<Loaded> {
    const cases = new Map<string, Arms>();
    for (const report of await reports(path))
      for (const c of report.cases) {
        const arms = cases.get(c.source_case_name) ?? {};
        arms[report.name] = [
          ...(arms[report.name] ?? []),
          {
            graders: Object.entries(c.assertions).map(([name, a]) => ({ name, passed: a.value })),
          },
        ];
        cases.set(c.source_case_name, arms);
      }
    return {
      result: { cases: [...cases].map(([name, arms]) => ({ name, arms })) },
      measured: new Map(),
    };
  },

  async tags(suite) {
    const source = await Bun.file(join(suite, "cases.py")).text();
    const tags = new Map<string, string[]>();
    for (const block of source.split("Case(").slice(1)) {
      const name = /name="([^"]+)"/.exec(block)?.[1];
      const list = /"tags":\s*\[([^\]]*)\]/.exec(block)?.[1];
      if (name !== undefined)
        tags.set(
          name,
          [...(list ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ""),
        );
    }
    return tags;
  },

  rescore() {
    return Promise.reject(
      new Error(
        "pydantic-evals can't re-run evaluators over a stored report: Dataset.evaluate runs the task",
      ),
    );
  },

  async traces(path) {
    const traces = new Map<string, Transcript[]>();
    for (const report of await reports(path))
      for (const c of report.cases) {
        const key = `${c.source_case_name}/${report.name}`;
        traces.set(key, [...(traces.get(key) ?? []), { reply: c.source_case_name, calls: [] }]);
      }
    return traces;
  },
};

export default adapter;
