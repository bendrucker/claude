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

/** Grades each stored output with the project's evaluators and prints the verdicts that changed. */
const RESCORE = `
import asyncio, inspect, json, sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, ".")
from cases import dataset

async def verdict(evaluator, ctx):
    result = evaluator.evaluate(ctx)
    if inspect.isawaitable(result):
        result = await result
    return bool(getattr(result, "value", result))

async def main():
    cases = {c.name: c for c in dataset.cases}
    flips = []
    for file in sorted(Path(sys.argv[1]).glob("*.json")):
        report = json.loads(file.read_text())
        runs = {}
        for stored in report["cases"]:
            name = stored["source_case_name"]
            run = runs[name] = runs.get(name, -1) + 1
            ctx = SimpleNamespace(inputs=stored["inputs"], metadata=stored["metadata"],
                                  expected_output=stored["expected_output"], output=stored["output"])
            for e in [*dataset.evaluators, *cases[name].evaluators]:
                grader = e.get_serialization_name()
                passed = await verdict(e, ctx)
                if passed != stored["assertions"][grader]["value"]:
                    flips.append({"grader": f"{name}/{report['name']}/{grader}", "run": str(run), "passed": passed})
    print(json.dumps(flips))

asyncio.run(main())
`;

const Flips = z.array(z.object({ grader: z.string(), run: z.string(), passed: z.boolean() }));

/** One report per variant, named for its experiment, which is the arm. */
async function reports(dir: string): Promise<Report[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => Report.parse(await Bun.file(join(dir, f)).json())));
}

export const adapter: Adapter = {
  name: "pydantic-evals",

  async run(suite, { args }) {
    const dir = mkdtempSync(join(tmpdir(), "pydantic-run-"));
    const checkout = join(dir, "checkout");
    await $`mkdir ${checkout}`.quiet();
    await $`cp -R ${suite}/. ${checkout}`.quiet();
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

  async rescore(suite, path) {
    const out =
      await $`uv run --no-project --with pydantic-evals --with pydantic-ai python -c ${RESCORE} ${path}`
        .cwd(suite)
        .text();
    return { path, flips: Flips.parse(JSON.parse(out)) };
  },

  async traces(path) {
    const traces = new Map<string, Transcript[]>();
    for (const report of await reports(path))
      for (const c of report.cases) {
        const key = `${c.source_case_name}/${report.name}`;
        traces.set(key, [...(traces.get(key) ?? []), { reply: c.output, calls: [] }]);
      }
    return traces;
  },
};

export default adapter;
