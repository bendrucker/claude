#!/usr/bin/env bun
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
import { getDataDir, sessionDbPath } from "./db";
import { cliAdapter, type QueryParams, runQuery } from "./query";

const ansi = (code: number, s: string): string => {
  const fg = code < 8 ? 30 + code : 82 + code;
  return `\x1b[${fg}m${s}\x1b[0m`;
};
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

const localTime = (ts: string): string =>
  new Date(`${ts.replace(" ", "T")}Z`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const num = (n: number): string => Math.round(n).toLocaleString();

// SUM over a BIGINT column yields a HUGEINT, which duckdb -json serializes as a string.
// Narrower than z.coerce.number(), which would read a null aggregate as a measured zero.
const Tokens = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
]);

export const Bucket = z.object({
  bucket: z.string(),
  msgs: z.number(),
  cost_usd_est: z.number(),
  input_tokens: Tokens,
  output_tokens: Tokens,
  cache_write_tokens: Tokens,
  cache_read_tokens: Tokens,
  cache_miss_ratio: z.number(),
  max_context_tokens: Tokens,
  top_model: z.string().nullable(),
});
type Bucket = z.infer<typeof Bucket>;

const SessionCost = z.object({
  session_id: z.string(),
  host: z.string(),
  repo: z.string().nullable(),
  msgs: z.number(),
  cost_usd_est: z.number(),
  last_activity: z.string(),
});
type SessionCost = z.infer<typeof SessionCost>;

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function topSessionsParams(host: string | undefined, days: number): QueryParams {
  return { after_date: daysAgo(days), host, limit: 10 };
}

export function timelineParams(
  session: string,
  host: string | undefined,
  bucket: number,
): QueryParams {
  return { session, host, bucket_minutes: bucket };
}

export function formatTopSessions(rows: SessionCost[], days: number): string {
  if (rows.length === 0) return `No sessions with usage in the last ${days} days.`;

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

  return [
    `Top sessions by estimated cost, last ${days} days:\n`,
    table(grid),
    dim("Pass --session <id> for a burn timeline. Cost is an estimate (see README)."),
  ].join("\n");
}

export function formatTimeline(rows: Bucket[], session: string, bucket: number): string {
  if (rows.length === 0) return `No assistant usage found for session ${session}.`;

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

  const total = (key: keyof Bucket): number => rows.reduce((sum, r) => sum + Number(r[key]), 0);
  const peakContext = Math.max(...rows.map((r) => r.max_context_tokens));
  const summary = [
    `session ${session}`,
    `${rows.length} buckets of ${bucket}m`,
    `${num(total("msgs"))} msgs`,
    `out ${num(total("output_tokens"))} tok`,
    `cache read ${num(total("cache_read_tokens"))} / write ${num(total("cache_write_tokens"))} tok`,
    `peak context ${num(peakContext)} tok`,
    ansi(3, `~$${total("cost_usd_est").toFixed(2)} est`),
  ].join(dim(" | "));

  return `${table(grid)}\n${summary}`;
}

if (import.meta.main) {
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

  const adapter = cliAdapter(dbPath);
  const { session, host, bucket, days } = argv.flags;

  if (session != null && session !== "") {
    const rows = await runQuery(
      adapter,
      { name: "usage-timeline" },
      Bucket,
      timelineParams(session, host, bucket),
    );
    console.log(formatTimeline(rows, session, bucket));
  } else {
    const rows = await runQuery(
      adapter,
      { name: "top-sessions" },
      SessionCost,
      topSessionsParams(host, days),
    );
    console.log(formatTopSessions(rows, days));
  }
}
