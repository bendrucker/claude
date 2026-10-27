import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import type { Truth } from "../../scripts/truth";

/** The slice of pydantic-evals' serialized `EvaluationReport` that truth is derived from. */
const Report = z.object({
  name: z.string(),
  cases: z.array(
    z.object({
      source_case_name: z.string(),
      metadata: z.object({ tags: z.array(z.string()) }),
      output: z.string(),
      assertions: z.record(z.string(), z.object({ value: z.boolean() })),
    }),
  ),
});

const here = import.meta.dirname;
const scratch = join(here, "../../../../../../tmp/adapter-pydantic-gen");

/** Runs the project against the scripted model and returns the directory it wrote reports to. */
async function record(mode: string): Promise<string> {
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, `${mode}-`));
  const project = join(work, "project");
  await $`bash ${join(here, "setup.sh")} ${project}`.quiet();
  const reports = join(work, "reports");
  await $`uv run --no-project --with pydantic-evals --with pydantic-ai python ${join(here, "fake_run.py")} ${mode} ${reports}`
    .cwd(project)
    .quiet();
  return reports;
}

async function truthOf(reports: string): Promise<Truth> {
  const parsed = await Promise.all(
    ["with", "without"].map(async (arm) =>
      Report.parse(await Bun.file(join(reports, `${arm}.json`)).json()),
    ),
  );
  const cases: Truth["cases"] = {};
  for (const report of parsed)
    for (const c of report.cases) {
      const entry = (cases[c.source_case_name] ??= { tags: c.metadata.tags, arms: {} });
      (entry.arms[report.name] ??= []).push({
        graders: Object.fromEntries(Object.entries(c.assertions).map(([k, v]) => [k, v.value])),
        reply: c.output,
      });
    }
  return {
    result: "reports",
    cases,
    rescore: {
      supported: false,
      reason:
        "pydantic-evals has no API to re-run evaluators over a stored report, only Dataset.evaluate, which runs the task",
    },
  };
}

await Promise.all(
  ["seen", "held"].map(async (mode) => {
    const reports = await record(mode);
    const dest = join(here, "fixtures", mode);
    mkdirSync(dest, { recursive: true });
    await $`rm -rf ${join(dest, "reports")}`.quiet();
    await $`cp -R ${reports} ${join(dest, "reports")}`.quiet();
    const truth = await truthOf(reports);
    await Bun.write(join(dest, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  }),
);
await $`rm -rf ${scratch}`.quiet();
