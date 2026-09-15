#!/usr/bin/env bun
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { cli } from "cleye";
import { table } from "table";
import { z } from "zod";
import { decodeJson } from "../../../../../packages/decode/index";
import { processInput } from "../../../hooks/gate";
import {
  assertDistinctSessions,
  bySession,
  caseId,
  type Decision,
  gateRule,
  type Present,
  Presents,
} from "./decisions";

// Replay recorded presentations through the gate as it is checked out now, one state directory per session, and compare its decisions with what the gate of the day actually did.

export const ReplayRow = z.object({
  id: z.string(),
  host: z.string(),
  chars: z.number(),
  actual: z.string(),
  replay: z.string(),
});
export type ReplayRow = z.infer<typeof ReplayRow>;
export const ReplayRows = z.array(ReplayRow);

export function replayDecision(reason: string | undefined): Decision {
  if (reason === undefined) return "none";
  const rule = gateRule(reason);
  return rule === null ? "unknown" : `gate:${rule}`;
}

function hookInput(present: Present): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: present.session_id,
    transcript_path: "",
    cwd: "",
    tool_name: "ExitPlanMode",
    tool_input: { plan: present.plan },
    tool_use_id: caseId(present),
  };
}

async function replaySession(
  presents: readonly Present[],
  stateRoot: string,
  index = 0,
  rows: ReplayRow[] = [],
): Promise<ReplayRow[]> {
  const present = presents[index];
  if (present === undefined) return rows;
  const output = await processInput(hookInput(present), stateRoot);
  const specific = output?.hookSpecificOutput;
  const reason =
    specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
  rows.push({
    id: caseId(present),
    host: present.host,
    chars: present.chars,
    actual: present.actual,
    replay: replayDecision(reason),
  });
  return replaySession(presents, stateRoot, index + 1, rows);
}

export async function replay(presents: readonly Present[]): Promise<ReplayRow[]> {
  assertDistinctSessions(presents);
  const root = await mkdtemp(join(tmpdir(), "plan-gate-replay-"));
  try {
    const sessions = [...bySession(presents).values()];
    const perSession = await Promise.all(sessions.map((list) => replaySession(list, root)));
    return perSession.flat();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function changed(rows: readonly ReplayRow[], baseline: readonly ReplayRow[]): ReplayRow[] {
  const before = new Map(baseline.map((row) => [row.id, row.replay]));
  return rows.filter((row) => before.has(row.id) && before.get(row.id) !== row.replay);
}

function tally(rows: readonly ReplayRow[], key: (row: ReplayRow) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return new Map([...counts].toSorted(([a], [b]) => a.localeCompare(b)));
}

export function summarize(rows: readonly ReplayRow[]): string {
  const gated = rows.filter(
    (row) => row.replay.startsWith("gate:") || row.actual.startsWith("gate:"),
  );
  const matrix = tally(gated, (row) => `${row.actual}\t${row.replay}`);
  const body = [...matrix].map(([key, n]) => {
    const [actual = "", decision = ""] = key.split("\t");
    return [actual, decision, String(n)];
  });
  return table([["actual", "replay", "n"], ...body]);
}

if (import.meta.main) {
  const argv = cli({
    name: "replay",
    help: { description: "Replay mined presentations through the checked-out gate." },
    flags: {
      presents: {
        type: String,
        default: join(import.meta.dirname, "..", "data", "presents.json"),
        description: "Mined presentations",
      },
      host: { type: String, description: "Only this host" },
      save: { type: String, description: "Write the decisions to this JSON path" },
      against: { type: String, description: "Saved run to diff the decisions against" },
    },
  });

  const all = decodeJson(Presents, await Bun.file(argv.flags.presents).text(), argv.flags.presents);
  const presents =
    argv.flags.host === undefined ? all : all.filter((p) => p.host === argv.flags.host);
  const rows = await replay(presents);

  console.log(`${rows.length} presentations replayed`);
  console.log(summarize(rows));

  if (argv.flags.against !== undefined) {
    const baseline = decodeJson(
      ReplayRows,
      await Bun.file(argv.flags.against).text(),
      argv.flags.against,
    );
    const diff = changed(rows, baseline);
    console.log(`${diff.length} decisions changed against ${argv.flags.against}`);
    if (diff.length > 0) {
      const before = new Map(baseline.map((row) => [row.id, row.replay]));
      console.log(
        table([
          ["id", "chars", "actual", "baseline", "now"],
          ...diff.map((row) => [
            row.id,
            String(row.chars),
            row.actual,
            before.get(row.id) ?? "",
            row.replay,
          ]),
        ]),
      );
    }
  }

  if (argv.flags.save !== undefined) {
    await mkdir(dirname(argv.flags.save), { recursive: true });
    await Bun.write(argv.flags.save, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`saved ${argv.flags.save}`);
  }
}
