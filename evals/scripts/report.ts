#!/usr/bin/env bun

import { readdirSync } from "node:fs";
import * as path from "node:path";
import { cli } from "cleye";
import { getBorderCharacters, table } from "table";
import { z } from "zod";
import type { RunCommand } from "./command";
import { literal, query, timestampLiteral } from "./duckdb";
import { resultsDir } from "./results";

export const BUDGET_USD = 20;
export const WINDOW_DAYS = 30;

// A single fresh run would otherwise project as 30 days of the same spend. The
// floor holds the projection to a week's worth of evidence at minimum.
export const MIN_OBSERVED_DAYS = 7;

const SECONDS_PER_DAY = 86_400;

export const SuiteRow = z.object({
  suite: z.string(),
  runs: z.number(),
  last_run_epoch: z.number().nullable(),
  last_cost: z.number(),
  api_30d: z.number(),
  subscription_30d: z.number(),
  window_start_epoch: z.number().nullable(),
});
export type SuiteRow = z.infer<typeof SuiteRow>;

export interface SuiteSummary {
  suite: string;
  runs: number;
  lastRun: string;
  lastCost: number;
  api30d: number;
  subscription30d: number;
  projected: number;
}

export interface Summary {
  suites: SuiteSummary[];
  runs: number;
  api30d: number;
  subscription30d: number;
  projected: number;
  budget: number;
  dir: string;
}

/**
 * The view every report query and every `--sql` query reads.
 *
 * Local runs and CI alike authenticate through Claude Code subscription
 * credentials, so a run bills the API only when someone keys it deliberately,
 * and promptfoo records nothing about auth. Billing therefore defaults to
 * subscription, and a keyed run counts against the budget by carrying
 * `metadata.billing: "api"` in its export.
 */
export function runsView(dir: string): string {
  const glob = literal(path.join(dir, "**", "*.json"));
  const prefix = literal(`${dir}/`);
  return `
CREATE OR REPLACE VIEW runs AS
SELECT
  filename AS path,
  COALESCE(NULLIF(regexp_extract(replace(filename, ${prefix}, ''), '^([^/]+)/', 1), ''), 'unsorted') AS suite,
  json->>'$.evalId' AS eval_id,
  TRY_CAST(json->>'$.results.timestamp' AS TIMESTAMP) AS created_at,
  CASE WHEN json->>'$.metadata.billing' = 'api' THEN 'api' ELSE 'subscription' END AS billing,
  COALESCE(list_sum(TRY_CAST(json_extract(json, '$.results.prompts[*].metrics.cost') AS DOUBLE[])), 0)::DOUBLE AS cost_usd,
  CASE WHEN billing = 'api' THEN cost_usd ELSE 0 END::DOUBLE AS api_usd,
  CASE WHEN billing = 'api' THEN 0 ELSE cost_usd END::DOUBLE AS subscription_usd,
  COALESCE(list_sum(TRY_CAST(json_extract(json, '$.results.prompts[*].metrics.testPassCount') AS INTEGER[])), 0)::INTEGER AS passes,
  COALESCE(list_sum(TRY_CAST(json_extract(json, '$.results.prompts[*].metrics.testFailCount') AS INTEGER[])), 0)::INTEGER AS failures
FROM read_json_objects(${glob}, filename=true);`.trim();
}

export function rollupSql(dir: string, now: Date): string {
  const cutoff = `${timestampLiteral(now)} - INTERVAL ${WINDOW_DAYS} DAY`;
  return `${runsView(dir)}
SELECT
  suite,
  COUNT(*)::INTEGER AS runs,
  epoch(MAX(created_at))::DOUBLE AS last_run_epoch,
  COALESCE(arg_max(cost_usd, created_at), 0)::DOUBLE AS last_cost,
  COALESCE(SUM(api_usd) FILTER (created_at >= ${cutoff}), 0)::DOUBLE AS api_30d,
  COALESCE(SUM(subscription_usd) FILTER (created_at >= ${cutoff}), 0)::DOUBLE AS subscription_30d,
  epoch(MIN(created_at) FILTER (created_at >= ${cutoff}))::DOUBLE AS window_start_epoch
FROM runs
GROUP BY suite
ORDER BY suite;`;
}

/** DuckDB errors on a glob that matches nothing, so an empty corpus never reaches it. */
export function hasResults(dir: string): boolean {
  try {
    return readdirSync(dir, { recursive: true }).some((entry) => String(entry).endsWith(".json"));
  } catch {
    return false;
  }
}

export async function loadSuites(dir: string, now: Date, run?: RunCommand): Promise<SuiteRow[]> {
  if (!hasResults(dir)) return [];
  return query(rollupSql(dir, now), SuiteRow, run);
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
  options: { now: Date; budget?: number; dir?: string },
): Summary {
  const suites = rows.map((row) => ({
    suite: row.suite,
    runs: row.runs,
    lastRun:
      row.last_run_epoch === null
        ? "unknown"
        : new Date(row.last_run_epoch * 1000).toISOString().slice(0, 10),
    lastCost: row.last_cost,
    api30d: row.api_30d,
    subscription30d: row.subscription_30d,
    projected: projectMonthly(row.api_30d, row.window_start_epoch, options.now),
  }));

  return {
    suites,
    runs: suites.reduce((total, suite) => total + suite.runs, 0),
    api30d: suites.reduce((total, suite) => total + suite.api30d, 0),
    subscription30d: suites.reduce((total, suite) => total + suite.subscription30d, 0),
    projected: suites.reduce((total, suite) => total + suite.projected, 0),
    budget: options.budget ?? BUDGET_USD,
    dir: options.dir ?? "",
  };
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function render(summary: Summary): string {
  if (summary.suites.length === 0) {
    return `No eval results in ${summary.dir}. Run an eval, then export it with evals/scripts/export-run.ts.`;
  }

  const head = [
    "Suite",
    "Runs",
    "Last run",
    "Last cost",
    `${WINDOW_DAYS}d API`,
    `${WINDOW_DAYS}d sub`,
    "Projected/mo",
  ];
  const rows = summary.suites.map((suite) => [
    suite.suite,
    String(suite.runs),
    suite.lastRun,
    usd(suite.lastCost),
    usd(suite.api30d),
    usd(suite.subscription30d),
    usd(suite.projected),
  ]);
  rows.push([
    "all",
    String(summary.runs),
    "",
    "",
    usd(summary.api30d),
    usd(summary.subscription30d),
    usd(summary.projected),
  ]);

  const share = summary.budget === 0 ? 0 : Math.round((summary.projected / summary.budget) * 100);
  const verdict = summary.projected > summary.budget ? "over the API budget" : "of the API budget";

  const right = { alignment: "right" } as const;
  const grid = table([head, ...rows], {
    border: getBorderCharacters("norc"),
    columns: [{}, right, {}, right, right, right, right],
    // Rules under the header and above the total, nowhere else: a rule per row would
    // double the height of a listing that lands in a context window.
    drawHorizontalLine: (index, size) =>
      index === 0 || index === 1 || index === size - 1 || index === size,
  }).trimEnd();

  const budgetLine = `${usd(summary.projected)} projected, ${share}% ${verdict} (${usd(summary.budget)}).`;
  const subscriptionLine =
    summary.subscription30d === 0
      ? ""
      : ` ${usd(summary.subscription30d)} of the last ${WINDOW_DAYS} days ran on the subscription and spends no budget.`;

  return `${grid}\n\n${budgetLine}${subscriptionLine}`;
}

if (import.meta.main) {
  const argv = cli({
    name: "report",
    help: {
      description:
        "Roll up promptfoo export costs in evals/results/, API-billed against the monthly budget and subscription-notional beside it.",
    },
    flags: {
      resultsDir: { type: String, description: "Results corpus root (default evals/results)" },
      budget: { type: Number, default: BUDGET_USD, description: "Monthly budget in USD" },
      sql: { type: String, description: "Run SQL against the `runs` view instead of the rollup" },
      json: { type: Boolean, description: "Emit the rollup rows as JSON" },
    },
  });

  const dir = resultsDir(argv.flags.resultsDir);
  const now = new Date();

  if (argv.flags.sql !== undefined) {
    if (!hasResults(dir)) {
      console.error(`No eval results in ${dir}.`);
      process.exit(1);
    }
    const rows = await query(`${runsView(dir)}\n${argv.flags.sql}`, z.looseObject({}));
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const summary = summarize(await loadSuites(dir, now), {
      now,
      budget: argv.flags.budget,
      dir,
    });
    console.log(argv.flags.json ? JSON.stringify(summary, null, 2) : render(summary));
  }
}
