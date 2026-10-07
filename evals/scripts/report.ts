#!/usr/bin/env bun

import { resolve } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { getBorderCharacters, table } from "table";
import { z } from "zod";
import type { RunCommand } from "./command";
import { literal, query, timestampLiteral } from "./duckdb";
import { repoRoot, resultFiles } from "./results";

export const BUDGET_USD = 20;
export const WINDOW_DAYS = 30;

// A single fresh run would otherwise project as 30 days of the same spend. The
// floor holds the projection to a week's worth of evidence at minimum.
export const MIN_OBSERVED_DAYS = 7;

const SECONDS_PER_DAY = 86_400;

export const SuiteRow = z.object({
  suite: z.string(),
  runs: z.number(),
  partial: z.number(),
  last_run_epoch: z.number().nullable(),
  last_score: z.number().nullable(),
  last_cost: z.number(),
  cost_30d: z.number(),
  seconds_30d: z.number(),
  window_start_epoch: z.number().nullable(),
});
export type SuiteRow = z.infer<typeof SuiteRow>;

export interface SuiteSummary {
  suite: string;
  runs: number;
  partial: number;
  lastRun: string;
  lastScore: number | null;
  lastCost: number;
  cost30d: number;
  seconds30d: number;
  projected: number;
}

export interface Summary {
  suites: SuiteSummary[];
  runs: number;
  cost30d: number;
  seconds30d: number;
  projected: number;
  budget: number;
  root: string;
}

/**
 * The `runs` and `cases` views every report query and every `--sql` query reads: one row
 * per `aggregate-result.json`, and one per case in each. A suite is named
 * `<plugin>/<suite>`, or `user/<suite>` for the suites under `evals/user/`.
 */
export function views(root: string, files: readonly string[]): string {
  const list = `[${files.map(literal).join(", ")}]`;
  const prefix = literal(`${resolve(root)}/`);
  return `
CREATE OR REPLACE VIEW raw AS
SELECT replace(filename, ${prefix}, '') AS path, json
FROM read_json_objects(${list}, filename=true);
CREATE OR REPLACE VIEW runs AS
SELECT
  path,
  regexp_replace(path, '^(?:plugins/([^/]+)/evals|evals/(user))/([^/]+)/results/.*$', '\\1\\2/\\3') AS suite,
  regexp_extract(path, '/results/([^/]+)/aggregate-result\\.json$', 1) AS run,
  TRY_CAST(json->>'$.startedAt' AS TIMESTAMP) AS started_at,
  COALESCE(TRY_CAST(json->>'$.costUsd' AS DOUBLE), 0)::DOUBLE AS cost_usd,
  COALESCE(TRY_CAST(json->>'$.durationSeconds' AS DOUBLE), 0)::DOUBLE AS duration_seconds,
  COALESCE(TRY_CAST(json->>'$.partial' AS BOOLEAN), false) AS partial,
  TRY_CAST(json->>'$.aggregates.casesTotal' AS INTEGER) AS cases_total,
  TRY_CAST(json->>'$.aggregates.casesPassed' AS INTEGER) AS cases_passed,
  TRY_CAST(json->>'$.aggregates.overallScore' AS DOUBLE) AS overall_score,
  TRY_CAST(json->>'$.aggregates.meanDelta' AS DOUBLE) AS mean_delta
FROM raw;
CREATE OR REPLACE VIEW cases AS
SELECT
  runs.suite,
  runs.run,
  runs.started_at,
  c->>'$.name' AS "case",
  TRY_CAST(c->>'$.aggregates.score' AS DOUBLE) AS score,
  TRY_CAST(c->>'$.aggregates.scoreWithout' AS DOUBLE) AS score_without,
  TRY_CAST(c->>'$.aggregates.delta' AS DOUBLE) AS delta
FROM raw
JOIN runs USING (path),
unnest(CAST(json->'$.cases' AS JSON[])) AS t(c);`.trim();
}

export function rollupSql(root: string, files: readonly string[], now: Date): string {
  const recent = `started_at >= ${timestampLiteral(now)} - INTERVAL ${WINDOW_DAYS} DAY`;
  return `${views(root, files)}
SELECT
  suite,
  COUNT(*)::INTEGER AS runs,
  COUNT(*) FILTER (partial)::INTEGER AS partial,
  epoch(MAX(started_at))::DOUBLE AS last_run_epoch,
  arg_max(overall_score, started_at)::DOUBLE AS last_score,
  COALESCE(arg_max(cost_usd, started_at), 0)::DOUBLE AS last_cost,
  COALESCE(SUM(cost_usd) FILTER (${recent}), 0)::DOUBLE AS cost_30d,
  COALESCE(SUM(duration_seconds) FILTER (${recent}), 0)::DOUBLE AS seconds_30d,
  epoch(MIN(started_at) FILTER (${recent}))::DOUBLE AS window_start_epoch
FROM runs
GROUP BY suite
ORDER BY suite;`;
}

export async function loadSuites(root: string, now: Date, run?: RunCommand): Promise<SuiteRow[]> {
  const files = resultFiles(root);
  // DuckDB errors on an empty file list, so an empty corpus never reaches it.
  if (files.length === 0) return [];
  return query(rollupSql(root, files, now), SuiteRow, run);
}

export function projectMonthly(
  cost30d: number,
  windowStartEpoch: number | null,
  now: Date,
): number {
  if (cost30d === 0 || windowStartEpoch === null) return 0;
  const elapsed = (now.getTime() / 1000 - windowStartEpoch) / SECONDS_PER_DAY;
  const observed = Math.min(WINDOW_DAYS, Math.max(MIN_OBSERVED_DAYS, elapsed));
  return (cost30d / observed) * WINDOW_DAYS;
}

export function summarize(
  rows: readonly SuiteRow[],
  options: { now: Date; budget?: number; root?: string },
): Summary {
  const suites = rows.map((row) => ({
    suite: row.suite,
    runs: row.runs,
    partial: row.partial,
    lastRun:
      row.last_run_epoch === null
        ? "unknown"
        : new Date(row.last_run_epoch * 1000).toISOString().slice(0, 10),
    lastScore: row.last_score,
    lastCost: row.last_cost,
    cost30d: row.cost_30d,
    seconds30d: row.seconds_30d,
    projected: projectMonthly(row.cost_30d, row.window_start_epoch, options.now),
  }));

  const sum = (pick: (suite: SuiteSummary) => number) =>
    suites.reduce((total, suite) => total + pick(suite), 0);
  return {
    suites,
    runs: sum((suite) => suite.runs),
    cost30d: sum((suite) => suite.cost30d),
    seconds30d: sum((suite) => suite.seconds30d),
    projected: sum((suite) => suite.projected),
    budget: options.budget ?? BUDGET_USD,
    root: options.root ?? "",
  };
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}

function percent(score: number | null): string {
  return score === null ? "–" : `${Math.round(score * 100)}%`;
}

export function render(summary: Summary): string {
  if (summary.suites.length === 0) {
    return `No native eval results under ${summary.root}. Run a suite with evals/native/run.ts.`;
  }

  const head = [
    "Suite",
    "Runs",
    "Partial",
    "Last run",
    "Last score",
    "Last cost",
    `${WINDOW_DAYS}d cost`,
    `${WINDOW_DAYS}d time`,
    "Projected/mo",
  ];
  const rows = summary.suites.map((suite) => [
    suite.suite,
    String(suite.runs),
    String(suite.partial),
    suite.lastRun,
    percent(suite.lastScore),
    usd(suite.lastCost),
    usd(suite.cost30d),
    minutes(suite.seconds30d),
    usd(suite.projected),
  ]);
  rows.push([
    "all",
    String(summary.runs),
    "",
    "",
    "",
    "",
    usd(summary.cost30d),
    minutes(summary.seconds30d),
    usd(summary.projected),
  ]);

  const share = summary.budget === 0 ? 0 : Math.round((summary.projected / summary.budget) * 100);
  const verdict = summary.projected > summary.budget ? "over the budget" : "of the budget";

  const right = { alignment: "right" } as const;
  const grid = table([head, ...rows], {
    border: getBorderCharacters("norc"),
    columns: [{}, right, right, {}, right, right, right, right, right],
    // Rules under the header and above the total, nowhere else: a rule per row would
    // double the height of a listing that lands in a context window.
    drawHorizontalLine: (index, size) =>
      index === 0 || index === 1 || index === size - 1 || index === size,
  }).trimEnd();

  return `${grid}\n\n${usd(summary.projected)} projected at list price, ${share}% ${verdict} (${usd(summary.budget)}).`;
}

function amount(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("Not a dollar amount.");
  return n;
}

export const program = new Command("report")
  .description(
    "Roll up native eval runs (every aggregate-result.json under plugins/*/evals/*/results/ and evals/user/*/results/) per suite, with a monthly projection of list-price spend against a budget.",
  )
  .option("--root <dir>", "repo root to read results under", repoRoot())
  .option("--budget <usd>", "monthly budget in USD", amount, BUDGET_USD)
  .option("--sql <query>", "run SQL against the `runs` and `cases` views instead of the rollup")
  .option("--json", "emit the rollup as JSON")
  .action(async (options) => {
    const now = new Date();
    if (options.sql !== undefined) {
      const files = resultFiles(options.root);
      if (files.length === 0) {
        console.error(`No native eval results under ${options.root}.`);
        process.exit(1);
      }
      const rows = await query(`${views(options.root, files)}\n${options.sql}`, z.looseObject({}));
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    const summary = summarize(await loadSuites(options.root, now), {
      now,
      budget: options.budget,
      root: options.root,
    });
    console.log(options.json === true ? JSON.stringify(summary, null, 2) : render(summary));
  });

if (import.meta.main) {
  await program.parseAsync();
}
