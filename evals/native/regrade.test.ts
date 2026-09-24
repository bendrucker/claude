import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result, regrade } from "./regrade";

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
