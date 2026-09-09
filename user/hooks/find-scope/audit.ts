#!/usr/bin/env bun

// The removal signal for the find-scope hook, per docs/settings.md.

import { cli } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../packages/decode/index";
import { findsUnboundedFromBroadRoot } from "./index";

const DB = `${process.env.HOME}/.claude/plugins/data/claude-code-bendrucker/session.duckdb`;

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

export function audit(calls: BashCall[]): Audit {
  const denied = calls.filter((call) => findsUnboundedFromBroadRoot(call.command));
  const timed = denied.filter((call) => call.ms >= 0).map((call) => call.ms);
  timed.sort((a, b) => a - b);

  const days = Math.max(new Set(calls.map((call) => call.day)).size, 1);
  const fast = denied.filter((call) => call.ms >= 0 && call.ms < 2000).length;

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
    return "[33mRETIRE[0m: fires under 15 times a month, so the CLAUDE.md line alone covers it.";
  }
  if (fastShare > 0.1) {
    return "[33mNARROW[0m: over a tenth of denials finished under 2s, so the root test is catching scoped searches.";
  }
  return "[32mKEEP[0m: still firing on real disk-wide searches at acceptable precision.";
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

  console.log(format(audit(readBashCalls(argv.flags.since))));
}
