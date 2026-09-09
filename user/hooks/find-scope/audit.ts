#!/usr/bin/env bun

// The removal signal for the find-scope hook, per docs/settings.md.

import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../packages/decode/index";
import { styleText } from "../../scripts/style";
import { findsUnboundedFromBroadRoot } from "./index";

// CLAUDE_PLUGIN_DATA is the session skill's own override for where its index
// lives, so an audit run against a copied corpus honors it too.
const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA ??
  `${process.env.HOME}/.claude/plugins/data/claude-code-bendrucker`;
const DB = `${DATA_DIR}/session.duckdb`;

// The date reaches DuckDB inside a SQL literal, so it is checked before it is
// interpolated rather than after.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date");

const BashCall = z.object({
  command: z.string(),
  ms: z.number(),
  day: z.string(),
});
const BashCalls = z.array(BashCall);
type BashCall = z.infer<typeof BashCall>;

const SQL = (since: string) => `
SELECT tc.command,
       coalesce(date_diff('millisecond', tc.timestamp, r.done), -1)::DOUBLE AS ms,
       tc.timestamp::DATE::VARCHAR AS day
FROM tool_calls tc
LEFT JOIN (
  SELECT tool_use_id, min(timestamp) AS done FROM content_items
  WHERE type = 'tool_result' GROUP BY tool_use_id
) r ON r.tool_use_id = tc.tool_id
WHERE tc.tool_name = 'Bash' AND tc.command IS NOT NULL AND tc.timestamp >= DATE '${since}'
`;

export function readBashCalls(since: string): BashCall[] {
  if (!IsoDate.safeParse(since).success) {
    throw new Error(`--since expects a YYYY-MM-DD date, got ${JSON.stringify(since)}`);
  }
  const proc = Bun.spawnSync(["duckdb", "-readonly", "-json", DB, "-c", SQL(since)]);
  if (proc.exitCode !== 0) {
    throw new Error(`duckdb failed: ${proc.stderr.toString().trim()}`);
  }
  return decodeJson(BashCalls, proc.stdout.toString(), "duckdb session index");
}

export interface Audit {
  scanned: number;
  denied: number;
  perMonth: number;
  medianMs: number;
  underTwoSeconds: number;
  fastShare: number;
  minutesSaved: number;
}

// A day with no Bash call is still a day the hook did not fire, so the rate
// divides by the calendar span rather than by the days that carry activity.
function calendarSpan(days: string[]): number {
  const sorted = days.toSorted();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first == null || last == null) return 1;
  const elapsed = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
  return Math.max(Math.round(elapsed / 86_400_000) + 1, 1);
}

export function audit(calls: BashCall[]): Audit {
  const denied = calls.filter((call) => findsUnboundedFromBroadRoot(call.command));
  const timed = denied.filter((call) => call.ms >= 0).map((call) => call.ms);
  timed.sort((a, b) => a - b);

  const days = calendarSpan(calls.map((call) => call.day));
  const fast = timed.filter((ms) => ms < 2000).length;

  return {
    scanned: calls.length,
    denied: denied.length,
    perMonth: (denied.length / days) * 30,
    medianMs: timed[Math.floor(timed.length / 2)] ?? 0,
    underTwoSeconds: fast,
    fastShare: timed.length === 0 ? 0 : fast / timed.length,
    minutesSaved: timed.reduce((total, ms) => total + ms, 0) / 60_000,
  };
}

// The thresholds docs/settings.md commits to.
export function verdict({ perMonth, fastShare }: Audit): string {
  if (perMonth < 15) {
    return `${styleText("yellow", "RETIRE")}: fires under 15 times a month, so the CLAUDE.md line alone covers it.`;
  }
  if (fastShare > 0.1) {
    return `${styleText("yellow", "NARROW")}: over a tenth of denials finished under 2s, so the root test is catching scoped searches.`;
  }
  return `${styleText("green", "KEEP")}: still firing on real disk-wide searches at acceptable precision.`;
}

export function format(result: Audit): string {
  return [
    `Bash calls scanned   ${result.scanned.toLocaleString()}`,
    `Denied               ${result.denied} (${result.perMonth.toFixed(1)}/month)`,
    `Median denied        ${(result.medianMs / 1000).toFixed(1)}s`,
    `Finished under 2s    ${result.underTwoSeconds} (${(result.fastShare * 100).toFixed(1)}%)`,
    `Wall clock avoided   ${result.minutesSaved.toFixed(1)} minutes`,
    "",
    verdict(result),
  ].join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "find-scope-audit",
    help: {
      description: "Report whether the find-scope hook still earns its place.",
    },
    flags: {
      since: {
        type: String,
        default: "2026-09-09",
        description: "Only count Bash calls on or after this date (YYYY-MM-DD)",
      },
    },
  });

  try {
    console.log(format(audit(readBashCalls(argv.flags.since))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
