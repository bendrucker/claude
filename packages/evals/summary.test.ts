import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { loadColumn } from "./column";
import { render } from "./compare";
import { findResults, latestResult, summarize } from "./summary";

const tmp = () => mkdtempSync(join(tmpdir(), "summary-"));

/** The jq title expression from `eval.yml` that `summary.ts` reproduces. */
const JQ_TITLE = `
  def pct: (. * 100 | round | tostring) + "%";
  "score \\(.aggregates.overallScore | pct)"
    + if .aggregates.meanDelta == null then "" else ", \\(.aggregates.meanDelta | pct) over no plugin" end
`;

interface Aggregates {
  overallScore: number;
  meanDelta?: number | null;
}

function makeResult(aggregates: Aggregates, scores: number[] = [1]) {
  return {
    costUsd: 1.234,
    aggregates: { casesTotal: 3, ...aggregates },
    cases: [
      {
        name: "c",
        arms: {
          with: scores.map((score) => ({ score, graders: [{ name: "g", passed: score === 1 }] })),
        },
      },
    ],
  };
}

async function writeJson(path: string, value: unknown): Promise<string> {
  await Bun.write(path, JSON.stringify(value));
  return path;
}

test.each<{ name: string; aggregates: Aggregates }>([
  { name: "with meanDelta", aggregates: { overallScore: 0.8333, meanDelta: 0.25 } },
  { name: "with meanDelta null", aggregates: { overallScore: 0.5, meanDelta: null } },
  { name: "without meanDelta", aggregates: { overallScore: 1 } },
  { name: "with a negative half delta", aggregates: { overallScore: 0.125, meanDelta: -0.125 } },
  { name: "with a delta rounding to -0", aggregates: { overallScore: 0, meanDelta: -0.004 } },
])("title matches the old jq expression $name", async ({ aggregates }) => {
  const path = await writeJson(join(tmp(), "aggregate-result.json"), makeResult(aggregates));
  const jq = (await $`jq -r ${JQ_TITLE} ${path}`.text()).trimEnd();
  expect((await summarize(path)).title).toBe(jq);
});

test("summarize reports cases and cost, and no flagged count without a baseline", async () => {
  const path = await writeJson(
    join(tmp(), "aggregate-result.json"),
    makeResult({ overallScore: 1 }),
  );
  expect(await summarize(path)).toEqual({ title: "score 100%", cases: 3, costUsd: 1.234 });
});

test("summarize counts the rows compare.ts's markdown flags", async () => {
  const dir = tmp();
  const base = await writeJson(
    join(dir, "base/aggregate-result.json"),
    makeResult({ overallScore: 0 }, [0, 0, 0, 0, 0]),
  );
  const current = await writeJson(
    join(dir, "current/aggregate-result.json"),
    makeResult({ overallScore: 1 }, [1, 1, 1, 1, 1]),
  );
  const summary = await summarize(current, { baseline: { label: "run 7", paths: [base] } });

  const columns = await Promise.all([loadColumn([base]), loadColumn([current])]);
  const markdown = render({ columns, labels: ["a", "b"], alpha: 0.1, markdown: true });
  const head = markdown.slice(0, markdown.indexOf("<details>"));
  const grepped = head.split("\n").filter((l) => /^\|.*\* \|/.test(l)).length;

  expect(grepped).toBeGreaterThan(0);
  expect(summary.flagged).toBe(grepped);
  expect(summary.title).toBe(`score 100%, ${grepped} flagged against run 7`);
});

test("latestResult picks the last results directory by name", async () => {
  const suite = tmp();
  await Promise.all(
    ["2026-01-02", "2026-01-10", "2026-01-03"].map((d) =>
      Bun.write(join(suite, "results", d, "aggregate-result.json"), "{}"),
    ),
  );
  await Bun.write(join(suite, "results/2026-01-10/scored/aggregate-result.json"), "{}");
  expect(latestResult(suite)).toBe(join(suite, "results/2026-01-10/aggregate-result.json"));
  expect(latestResult(tmp())).toBeUndefined();
});

test("findResults finds runs at any depth and leaves out nested post-scorer results", async () => {
  const dir = tmp();
  const files = [
    "1/eval-x-1/run-a/aggregate-result.json",
    "1/eval-x-1/run-a/scored/aggregate-result.json",
    "2/run-b/aggregate-result.json",
  ];
  await Promise.all(files.map((f) => Bun.write(join(dir, f), "{}")));
  expect(findResults(dir)).toEqual([join(dir, files[0] ?? ""), join(dir, files[2] ?? "")]);
});

test("the CLI prints the suite name, result path, and summary as JSON", async () => {
  const root = tmp();
  const suite = join(root, "plugins/p/evals/s");
  const result = await writeJson(
    join(suite, "results/run-1/aggregate-result.json"),
    makeResult({ overallScore: 1 }, [1, 1, 1, 1, 1]),
  );
  await Bun.write(join(suite, "c/case.yaml"), "tags: [t]\n");
  const baseline = join(root, "baseline");
  await writeJson(
    join(baseline, "9/eval-p-s-9/run-0/aggregate-result.json"),
    makeResult({ overallScore: 0 }, [0, 0, 0, 0, 0]),
  );
  const cli = join(import.meta.dir, "../../evals/native/summary.ts");
  const out = z
    .looseObject({ title: z.string() })
    .parse(await $`bun ${cli} ${suite} --baseline ${baseline} --label ${"run 9"}`.json());
  expect(out).toMatchObject({
    suite: "p/s",
    result,
    baseline: [join(baseline, "9/eval-p-s-9/run-0/aggregate-result.json")],
    cases: 3,
    costUsd: 1.234,
  });
  expect(out.title).toMatch(/^score 100%, \d+ flagged against run 9$/);
});
