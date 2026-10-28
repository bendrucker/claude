import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadColumn } from "./column";
import { erroredRuns, Result, Run, readResult, score, writeResult } from "./result";

const grader = (name: string, passed: boolean, extra: object = {}) => ({
  name,
  passed,
  ...extra,
});

test("Result reads a post-scorer's minimal shape with the runner's defaults", () => {
  const parsed = Result.parse({
    cases: [{ name: "c", arms: { with: [{ score: 1, graders: [grader("g", true)] }] } }],
  });
  expect(parsed.cases[0]?.arms.with?.[0]?.graders[0]).toEqual({
    name: "g",
    passed: true,
    weight: 1,
    scored: true,
    withOnly: false,
  });
});

test.each<{ name: string; run: Run; arm: string; expected: number | null }>([
  {
    name: "weights scored graders",
    run: Run.parse({
      score: 0,
      graders: [grader("a", true, { weight: 3 }), grader("b", false)],
    }),
    arm: "with",
    expected: 0.75,
  },
  {
    name: "leaves out a with-only grader on the without arm",
    run: Run.parse({
      score: 0,
      graders: [grader("a", true), grader("b", false, { withOnly: true })],
    }),
    arm: "without",
    expected: 1,
  },
  {
    name: "keeps an aborted run's score",
    run: Run.parse({
      score: 0,
      graders: [grader("a", true)],
      aborted: { server: "s", tool: "t", reason: "expect" },
    }),
    arm: "with",
    expected: 0,
  },
  {
    name: "keeps an ungraded run's score",
    run: Run.parse({ score: 0 }),
    arm: "with",
    expected: 0,
  },
])("score $name", ({ run, arm, expected }) => {
  expect(score(run, arm)).toBe(expected);
});

test("erroredRuns tells a graded error from one the runner left ungraded", () => {
  const result = Result.parse({
    cases: [
      {
        name: "c",
        arms: {
          with: [
            { score: 1, graders: [grader("a", true)], error: "timed out after 300s" },
            { score: 0, graders: [], error: "API Error: 429" },
            { score: 1, graders: [grader("a", true)], error: null },
          ],
        },
      },
    ],
  });
  expect(erroredRuns(result)).toEqual([
    { label: "c/with/0: timed out after 300s", graded: true },
    { label: "c/with/1: API Error: 429", graded: false },
  ]);
});

test("writeResult scores runs as the runner does and writes a trace per reply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "write-"));
  await writeResult(dir, {
    c: {
      with: [
        { graders: [grader("a", true), grader("b", false)], reply: "one two" },
        { graders: [grader("a", true), grader("b", true)] },
      ],
      without: [{ graders: [grader("a", false), grader("b", true)] }],
    },
  });
  const written = await readResult(join(dir, "aggregate-result.json"));
  expect(written.schemaVersion).toBe(1);
  expect(written.cases[0]?.arms.with?.map((r) => r.score)).toEqual([0.5, 1]);
  expect(written.cases[0]?.aggregates).toEqual({ score: 0.75, scoreWithout: 0.5, delta: 0.25 });
  const cell = (await loadColumn([join(dir, "aggregate-result.json")])).get("c/with");
  expect([cell?.scores, cell?.words]).toEqual([[0.5, 1], [2]]);
});

test("writeResult takes a scorer's own score and keeps its metrics on the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "write-"));
  await writeResult(dir, {
    c: {
      with: [
        { score: 0.5, graders: [grader("lead@1", false)], metrics: { tokens: 10, seconds: 2 } },
        { graders: [grader("lead@1", true)] },
      ],
    },
  });
  const runs = (await readResult(join(dir, "aggregate-result.json"))).cases[0]?.arms.with;
  expect(runs?.map((r) => r.score)).toEqual([0.5, 1]);
  expect(runs?.map((r) => r.metrics)).toEqual([{ tokens: 10, seconds: 2 }, undefined]);
});
