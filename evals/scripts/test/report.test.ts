import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import { query } from "../duckdb";
import {
  loadSuites,
  MIN_OBSERVED_DAYS,
  projectMonthly,
  render,
  summarize,
  type SuiteRow,
  views,
  WINDOW_DAYS,
} from "../report";
import { resultFiles } from "../results";

const CORPUS = join(import.meta.dirname, "corpus");
const EMPTY = mkdtempSync(join(tmpdir(), "report-"));
const NOW = new Date("2026-09-28T00:00:00.000Z");

function epoch(iso: string): number {
  return new Date(iso).getTime() / 1000;
}

test("resultFiles finds plugin and user suite runs, leaving out regraded copies", () => {
  expect(resultFiles(CORPUS).map((path) => relative(CORPUS, path))).toEqual([
    "evals/user/ship/results/2026-09-27T08-00-00Z/aggregate-result.json",
    "plugins/pull-request/evals/create/results/2026-09-25T17-45-00Z-HEAD/aggregate-result.json",
    "plugins/writing/evals/rewrite/results/2026-08-01T12-00-00Z/aggregate-result.json",
    "plugins/writing/evals/rewrite/results/2026-09-10T09-30-00Z/aggregate-result.json",
  ]);
});

test("resultFiles is empty for a root with no results", () => {
  expect(resultFiles(EMPTY)).toEqual([]);
});

test.each<{ name: string; cost: number; start: string | null; expected: number }>([
  { name: "nothing spent", cost: 0, start: "2026-09-01T12:00:00Z", expected: 0 },
  { name: "no runs in the window", cost: 5, start: null, expected: 0 },
  { name: "a full window scales one to one", cost: 6, start: "2026-08-29T00:00:00Z", expected: 6 },
  {
    name: "a fresh run is held to the observation floor",
    cost: 7,
    start: "2026-09-27T00:00:00Z",
    expected: (7 / MIN_OBSERVED_DAYS) * WINDOW_DAYS,
  },
])("projectMonthly with $name", ({ cost, start, expected }) => {
  expect(projectMonthly(cost, start === null ? null : epoch(start), NOW)).toBeCloseTo(expected, 5);
});

// The August rewrite run falls outside the window: it counts as a run but not as spend.
test("loadSuites rolls each suite up from its runs", async () => {
  expect(await loadSuites(CORPUS, NOW)).toEqual([
    {
      suite: "pull-request/create",
      runs: 1,
      partial: 1,
      last_run_epoch: epoch("2026-09-25T17:45:00Z"),
      last_score: 1,
      last_cost: 1.25,
      cost_30d: 1.25,
      seconds_30d: 200,
      window_start_epoch: epoch("2026-09-25T17:45:00Z"),
    },
    {
      suite: "user/ship",
      runs: 1,
      partial: 0,
      last_run_epoch: epoch("2026-09-27T08:00:00Z"),
      last_score: 0.5,
      last_cost: 0.75,
      cost_30d: 0.75,
      seconds_30d: 120,
      window_start_epoch: epoch("2026-09-27T08:00:00Z"),
    },
    {
      suite: "writing/rewrite",
      runs: 2,
      partial: 0,
      last_run_epoch: epoch("2026-09-10T09:30:00Z"),
      last_score: 0.875,
      last_cost: 2.5,
      cost_30d: 2.5,
      seconds_30d: 300,
      window_start_epoch: epoch("2026-09-10T09:30:00Z"),
    },
  ] satisfies SuiteRow[]);
});

test("loadSuites returns nothing for an empty root", async () => {
  expect(await loadSuites(EMPTY, NOW)).toEqual([]);
});

// A case without a without arm has a null delta, which the view keeps rather than zeroing.
test("the cases view unnests each run's case scores", async () => {
  const rows = await query(
    `${views(CORPUS, resultFiles(CORPUS))}\nSELECT suite, run, "case", score, score_without, delta FROM cases ORDER BY suite, run, "case";`,
    z.object({
      suite: z.string(),
      run: z.string(),
      case: z.string(),
      score: z.number(),
      score_without: z.number().nullable(),
      delta: z.number().nullable(),
    }),
  );

  expect(rows).toMatchSnapshot();
});

test("render lays out the rollup against the budget", async () => {
  const summary = summarize(await loadSuites(CORPUS, NOW), { now: NOW, root: CORPUS });
  expect(render(summary)).toMatchSnapshot();
});

test("render explains an empty root", () => {
  expect(render(summarize([], { now: NOW, root: "/repo" }))).toBe(
    "No native eval results under /repo. Run a suite with evals/native/run.ts.",
  );
});
