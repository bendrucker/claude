import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regrade } from "./regrade";
import { type Result as Parsed, Result, readResult, score } from "./result";

const grader = (name: string, passed: boolean, withOnly = false) => ({
  name,
  passed,
  weight: 1,
  scored: !withOnly,
  withOnly,
  explanation: "recorded",
});

test("re-grades against the current grader set and rescores each run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "regrade-"));
  const results = join(dir, "results/run");
  const trace = [
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] },
    },
    { type: "result", result: "Fixed in 230ms." },
  ];
  await Promise.all([
    Bun.write(join(dir, "one/graders/fact.md"), "---\ntype: regex\npattern: '230 ?ms'\n---\n"),
    Bun.write(
      join(dir, "one/graders/ran.md"),
      "---\ntype: regex\npattern: 'bun test'\ntarget: trace\n---\n",
    ),
    Bun.write(join(dir, "one/graders/judge.md"), "---\ntype: llm\n---\nIs it good?\n"),
    Bun.write(
      join(dir, "one/graders/brief.md"),
      "---\ntype: regex\npattern: 'Fixed'\nweight: 2\n---\n",
    ),
    Bun.write(
      join(results, "traces/one-with-0.jsonl"),
      trace.map((l) => JSON.stringify(l)).join("\n"),
    ),
    Bun.write(
      join(results, "aggregate-result.json"),
      JSON.stringify({
        aggregates: { overallScore: 0 },
        cases: [
          {
            name: "one",
            arms: {
              with: [
                {
                  score: 1 / 3,
                  graders: [
                    grader("fact", false),
                    grader("ran", false),
                    grader("judge", true),
                    grader("gone", false),
                  ],
                },
              ],
              without: [{ score: 0, graders: [grader("fact", false)] }],
            },
          },
        ],
      }),
    ),
  ]);
  const out = join(dir, "results/run-regraded");
  const flips = await regrade(dir, results, out);
  expect(flips).toEqual([
    { grader: "one/fact", run: "one-with-0", passed: true },
    { grader: "one/ran", run: "one-with-0", passed: true },
    { grader: "one/gone", run: "one-with-0", passed: undefined },
    { grader: "one/brief", run: "one-with-0", passed: true },
  ]);
  const written = Result.parse(await Bun.file(join(out, "aggregate-result.json")).json());
  expect(written.aggregates).toBeUndefined();
  const run = written.cases[0]?.arms.with?.[0];
  expect(run?.score).toBe(1);
  expect(run?.graders.map((g) => [g.name, g.weight])).toEqual([
    ["fact", 1],
    ["ran", 1],
    ["judge", 1],
    ["brief", 2],
  ]);
  expect(written.cases[0]?.arms.without?.[0]?.score).toBe(0);
  expect(await Bun.file(join(out, "traces/one-with-0.jsonl")).exists()).toBe(true);
});

test("takes a swapped-in regex grader's arm from its file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "regrade-"));
  const results = join(dir, "results/run");
  const trace = [{ type: "result", result: "Done." }];
  await Promise.all([
    Bun.write(
      join(dir, "quiet/graders/no-skill.md"),
      '---\ntype: regex\npattern: \'"skill":"create"\'\nmatch: not_contains\ntarget: trace\n---\n',
    ),
    Bun.write(
      join(results, "traces/quiet-with-0.jsonl"),
      trace.map((l) => JSON.stringify(l)).join("\n"),
    ),
    Bun.write(
      join(results, "aggregate-result.json"),
      JSON.stringify({
        cases: [
          {
            name: "quiet",
            arms: { with: [{ score: 1, graders: [grader("no-skill", true, true)] }] },
          },
        ],
      }),
    ),
  ]);
  const out = join(dir, "results/run-regraded");
  await regrade(dir, results, out);
  const written = Result.parse(await Bun.file(join(out, "aggregate-result.json")).json());
  const run = written.cases[0]?.arms.with?.[0];
  expect(run?.graders.map((g) => [g.name, g.scored, g.withOnly])).toEqual([
    ["no-skill", true, false],
  ]);
  expect(run?.score).toBe(1);
});

// Runner output from a no-diary run and a pull-request create run, with the no-diary case's
// graders as they stood at the commit that ran. A drift from the runner's weighting, with-only
// exclusion, or regex semantics changes a recomputed score or flips a verdict here.
const FIXTURES = join(import.meta.dirname, "test");

const verdicts = (result: Parsed) =>
  result.cases.map((c) => [
    c.name,
    Object.entries(c.arms).map(([arm, runs]) => [
      arm,
      runs.map((r) => [r.score, r.graders.map((g) => [g.name, g.passed, g.scored])]),
    ]),
  ]);

test.each(["no-diary/run", "create"])("score reproduces every run score in %s", async (dir) => {
  const result = await readResult(join(FIXTURES, dir, "aggregate-result.json"));
  const runs = result.cases.flatMap((c) =>
    Object.entries(c.arms).flatMap(([arm, rs]) => rs.map((run) => ({ arm, run }))),
  );
  expect(runs.length).toBeGreaterThan(0);
  for (const { arm, run } of runs) expect(score(run, arm)).toBeCloseTo(run.score ?? NaN, 9);
});

test("regrade reproduces the runner's verdicts from the stored traces", async () => {
  const fixture = join(FIXTURES, "no-diary");
  const out = join(mkdtempSync(join(tmpdir(), "regrade-")), "run-regraded");
  expect(await regrade(join(fixture, "suite"), join(fixture, "run"), out)).toEqual([]);
  const before = await readResult(join(fixture, "run", "aggregate-result.json"));
  const after = await readResult(join(out, "aggregate-result.json"));
  expect(verdicts(after)).toEqual(verdicts(before));
});
