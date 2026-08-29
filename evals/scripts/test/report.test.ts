import { expect, test } from "bun:test";
import * as path from "node:path";
import { z } from "zod";
import { query } from "../duckdb";
import {
  hasResults,
  loadSuites,
  MIN_OBSERVED_DAYS,
  projectMonthly,
  render,
  runsView,
  summarize,
  type SuiteRow,
  WINDOW_DAYS,
} from "../report";

const CORPUS = path.join(import.meta.dirname, "results");
const NOW = new Date("2026-08-28T00:00:00.000Z");

function epoch(iso: string): number {
  return new Date(iso).getTime() / 1000;
}

test.each<{ name: string; dir: string; expected: boolean }>([
  { name: "a corpus with exports", dir: CORPUS, expected: true },
  { name: "a directory that does not exist", dir: path.join(CORPUS, "missing"), expected: false },
])("hasResults sees $name", ({ dir, expected }) => {
  expect(hasResults(dir)).toBe(expected);
});

test.each<{ name: string; cost: number; start: string | null; expected: number }>([
  { name: "nothing spent", cost: 0, start: "2026-08-01T12:00:00Z", expected: 0 },
  { name: "no runs in the window", cost: 5, start: null, expected: 0 },
  {
    name: "a full window scales one to one",
    cost: 6,
    start: "2026-07-29T00:00:00Z",
    expected: 6,
  },
  {
    name: "a fresh run is held to the observation floor",
    cost: 7,
    start: "2026-08-27T00:00:00Z",
    expected: (7 / MIN_OBSERVED_DAYS) * WINDOW_DAYS,
  },
])("projectMonthly with $name", ({ cost, start, expected }) => {
  expect(projectMonthly(cost, start === null ? null : epoch(start), NOW)).toBeCloseTo(expected, 5);
});

// The corpus fixtures carry a `metadata.platform`: the darwin run bills the
// subscription, the linux runs bill the API, and the pre-window run carries none
// at all, which the view treats as API-billed.
test("loadSuites splits each suite's window by billing source", async () => {
  const rows = await loadSuites(CORPUS, NOW);

  expect(rows).toEqual([
    {
      suite: "issue-refine",
      runs: 1,
      last_run_epoch: epoch("2026-08-25T17:45:00Z"),
      last_cost: 0.25,
      api_30d: 0.25,
      subscription_30d: 0,
      window_start_epoch: epoch("2026-08-25T17:45:00Z"),
    },
    {
      suite: "pr-body",
      runs: 3,
      last_run_epoch: epoch("2026-08-20T09:30:00Z"),
      last_cost: 1.5,
      api_30d: 1.5,
      subscription_30d: 1,
      window_start_epoch: epoch("2026-08-01T12:00:00Z"),
    },
  ] satisfies SuiteRow[]);
});

// DuckDB emits an uncast list_sum as HUGEINT, which its JSON writer renders as a
// string. The `--sql` escape hatch hands the view's rows straight to the caller,
// so the casts that keep `passes` a number rather than "14" are pinned here.
test("the runs view types every numeric column as a number", async () => {
  const rows = await query(
    `${runsView(CORPUS)}\nSELECT billing, cost_usd, api_usd, subscription_usd, passes, failures FROM runs ORDER BY eval_id;`,
    z.object({
      billing: z.enum(["api", "subscription"]),
      cost_usd: z.number(),
      api_usd: z.number(),
      subscription_usd: z.number(),
      passes: z.number(),
      failures: z.number(),
    }),
  );

  expect(rows).toMatchInlineSnapshot(`
    [
      {
        "api_usd": 0,
        "billing": "subscription",
        "cost_usd": 1,
        "failures": 3,
        "passes": 13,
        "subscription_usd": 1,
      },
      {
        "api_usd": 1.5,
        "billing": "api",
        "cost_usd": 1.5,
        "failures": 1,
        "passes": 15,
        "subscription_usd": 0,
      },
      {
        "api_usd": 0.25,
        "billing": "api",
        "cost_usd": 0.25,
        "failures": 0,
        "passes": 4,
        "subscription_usd": 0,
      },
      {
        "api_usd": 5,
        "billing": "api",
        "cost_usd": 5,
        "failures": 5,
        "passes": 11,
        "subscription_usd": 0,
      },
    ]
  `);
});

test("loadSuites returns nothing for an empty corpus", async () => {
  expect(await loadSuites(path.join(CORPUS, "missing"), NOW)).toEqual([]);
});

test("render lays out the rollup against the budget", async () => {
  const summary = summarize(await loadSuites(CORPUS, NOW), { now: NOW, dir: CORPUS });
  expect(render(summary)).toMatchSnapshot();
});

test("render explains an empty corpus", () => {
  expect(render(summarize([], { now: NOW, dir: "/corpus" }))).toBe(
    "No eval results in /corpus. Run an eval, then export it with evals/scripts/export-run.ts.",
  );
});
