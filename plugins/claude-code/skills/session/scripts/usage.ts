#!/usr/bin/env bun
import * as path from "node:path";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
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
async function query<T>(dbPath: string, sql: string, schema: z.ZodType<T>): Promise<T[]> {
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
  return z.array(schema).parse(JSON.parse(out.trim() || "[]"));
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

const Bucket = z.object({
  bucket: z.string(),
  msgs: z.number(),
  cost_usd_est: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_write_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_miss_ratio: z.number(),
  max_context_tokens: z.number(),
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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function renderTopSessions(dbPath: string, host: string | undefined, days: number) {
  const querySql = await Bun.file(path.join(QUERIES_DIR, "top-sessions.sql")).text();
  const sql = setVariables({ after_date: daysAgo(days), host }) + querySql;
  const rows = await query(dbPath, sql, SessionCost);
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
  const rows = await query(dbPath, sql, Bucket);
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
