#!/usr/bin/env bun
import * as path from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { getDataDir, sessionDbPath } from "./db";

const QUERIES_DIR = path.join(import.meta.dirname, "..", "resources", "queries");

const ansi = (code: number, s: string): string => {
  const fg = code < 8 ? 30 + code : 82 + code;
  return `\x1b[${fg}m${s}\x1b[0m`;
};
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// Query read-only so a concurrent refresh (or parallel read-only agents) never contends
// for the write lock. SET VARIABLE lines are prepended to the named query's SQL rather
// than duplicating it here.
async function query<T>(dbPath: string, sql: string): Promise<T[]> {
  const proc = Bun.spawn(["duckdb", "-readonly", "-json", dbPath], {
    stdin: Buffer.from(sql),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(err.trim() || `duckdb exited ${code}`);
  return JSON.parse(out.trim() || "[]") as T[];
}

function setVariables(vars: Record<string, string | number | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    const literal = typeof value === "number" ? String(value) : sqlString(value);
    lines.push(`SET VARIABLE "${key}" = ${literal};`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

const localTime = (ts: string): string =>
  new Date(`${ts.replace(" ", "T")}Z`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const num = (n: number): string => Math.round(n).toLocaleString();

interface Bucket {
  bucket: string;
  msgs: number;
  cost_usd_est: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cache_miss_ratio: number;
  max_context_tokens: number;
  top_model: string | null;
}

interface SessionCost {
  session_id: string;
  host: string;
  repo: string | null;
  msgs: number;
  cost_usd_est: number;
  last_activity: string;
}

// Cost weighting mirrors the query files: cache reads bill 0.1x the input rate, cache
// writes 1.25x for the 5m TTL and 2x for the 1h TTL. Per-model rates come from the
// shared macros so the rate table stays in one place.
const TOP_SESSIONS_SQL = `
WITH priced AS (
  SELECT
    mu.*,
    model_input_rate(mu.model)  AS in_rate,
    model_output_rate(mu.model) AS out_rate,
    COALESCE(mu.cache_1h_tokens, 0) AS w1h,
    COALESCE(mu.cache_5m_tokens,
             COALESCE(mu.cache_creation_tokens, 0) - COALESCE(mu.cache_1h_tokens, 0)) AS w5m
  FROM message_usage mu
  WHERE date_filter(mu.timestamp, getvariable('after_date'), NULL)
    AND host_filter(mu.host, getvariable('host'))
)
SELECT
  session_id,
  ANY_VALUE(host)                                   AS host,
  regexp_extract(ANY_VALUE(project_path), '[^/]+$') AS repo,
  COUNT(*)                                          AS msgs,
  ROUND(SUM(
    (COALESCE(input_tokens, 0) * in_rate
     + w5m * 1.25 * in_rate
     + w1h * 2.0  * in_rate
     + COALESCE(cache_read_tokens, 0) * 0.1 * in_rate
     + COALESCE(output_tokens, 0) * out_rate) / 1e6
  ), 2)                                             AS cost_usd_est,
  strftime(MAX(timestamp), '%Y-%m-%d %H:%M:%S')     AS last_activity
FROM priced
GROUP BY session_id
ORDER BY cost_usd_est DESC NULLS LAST
LIMIT 10;
`;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function renderTopSessions(dbPath: string, host: string | undefined, days: number) {
  const sql = setVariables({ after_date: daysAgo(days), host }) + TOP_SESSIONS_SQL;
  const rows = await query<SessionCost>(dbPath, sql);
  if (rows.length === 0) {
    console.log(`No sessions with usage in the last ${days} days.`);
    return;
  }
  const grid = [["SESSION", "HOST", "REPO", "MSGS", "COST $"]];
  for (const r of rows) {
    grid.push([
      r.session_id.slice(0, 8),
      r.host,
      r.repo ?? "-",
      num(r.msgs),
      ansi(3, r.cost_usd_est.toFixed(2)),
    ]);
  }
  console.log(`Top sessions by estimated cost, last ${days} days:\n`);
  console.log(table(grid));
  console.log(dim("Pass --session <id> for a burn timeline. Cost is an estimate (see README)."));
}

async function renderTimeline(
  dbPath: string,
  session: string,
  host: string | undefined,
  bucket: number,
) {
  const querySql = await Bun.file(path.join(QUERIES_DIR, "usage-timeline.sql")).text();
  const sql = setVariables({ session, host, bucket_minutes: bucket }) + querySql;
  const rows = await query<Bucket>(dbPath, sql);
  if (rows.length === 0) {
    console.log(`No assistant usage found for session ${session}.`);
    return;
  }

  const maxCost = Math.max(...rows.map((r) => r.cost_usd_est), 0);
  const barWidth = (cost: number): string => {
    if (maxCost <= 0) return "";
    const width = Math.round((cost / maxCost) * 24);
    return "█".repeat(cost > 0 ? Math.max(width, 1) : 0);
  };

  const grid = [["TIME", "MSGS", "BURN", "COST $", "MISS"]];
  for (const r of rows) {
    grid.push([
      localTime(r.bucket),
      num(r.msgs),
      ansi(6, barWidth(r.cost_usd_est)),
      ansi(3, r.cost_usd_est.toFixed(2)),
      r.cache_miss_ratio > 0.5
        ? ansi(1, r.cache_miss_ratio.toFixed(2))
        : r.cache_miss_ratio.toFixed(2),
    ]);
  }
  console.log(table(grid));

  const total = (key: keyof Bucket): number => rows.reduce((sum, r) => sum + Number(r[key]), 0);
  const totalCost = total("cost_usd_est");
  const peakContext = Math.max(...rows.map((r) => r.max_context_tokens));
  console.log(
    [
      `session ${session}`,
      `${rows.length} buckets of ${bucket}m`,
      `${num(total("msgs"))} msgs`,
      `out ${num(total("output_tokens"))} tok`,
      `cache read ${num(total("cache_read_tokens"))} / write ${num(total("cache_write_tokens"))} tok`,
      `peak context ${num(peakContext)} tok`,
      ansi(3, `~$${totalCost.toFixed(2)} est`),
    ].join(dim(" | ")),
  );
}

const argv = cli({
  name: "usage",
  help: {
    description: "Render a session's token-burn timeline (or the top sessions by cost).",
  },
  flags: {
    session: { type: String, description: "Session id to profile (omit for a top-cost list)" },
    host: { type: String, description: "Scope to one imported host" },
    bucket: { type: Number, default: 10, description: "Bucket size in minutes" },
    days: { type: Number, default: 14, description: "Lookback window for the top-cost list" },
  },
});

const dbPath = sessionDbPath(getDataDir());
if (!(await Bun.file(dbPath).exists())) {
  console.error(`Session index not found at ${dbPath}. Run scripts/refresh.ts first.`);
  process.exit(1);
}

if (argv.flags.session) {
  await renderTimeline(dbPath, argv.flags.session, argv.flags.host, argv.flags.bucket);
} else {
  await renderTopSessions(dbPath, argv.flags.host, argv.flags.days);
}
