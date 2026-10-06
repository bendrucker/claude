#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const INTERACTIVE = new Set(["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"]);
const OUT = "classifier-telemetry.legacy.0.jsonl";

const LegacyRecord = z.object({
  session_id: z.string(),
  tool_use_id: z.string(),
  agent_id: z.string().nullable(),
  tool: z.string(),
  decision: z.string().nullable(),
  rule: z.string().nullable(),
  reason: z.string().nullable(),
  started_at: z.number(),
  check_ms: z.number().nullable(),
  duration_ms: z.number(),
  outcome: z.string(),
});

type LegacyRecord = z.infer<typeof LegacyRecord>;

/** The OTel log record the mod-events writer emits, one per line. */
interface ModEventRecord {
  timestamp: string;
  severity_text: "INFO" | "WARN";
  severity_number: 9 | 13;
  event_name: string;
  attributes: Record<string, unknown>;
  resource: Record<string, string>;
  scope: { name: string };
}

interface Totals {
  sessions: number;
  skipped: number;
  records: number;
  unreadable: number;
}

export function toEvent(record: LegacyRecord): ModEventRecord {
  const isOk = record.outcome === "ok";
  return {
    timestamp: new Date(record.started_at + record.duration_ms).toISOString(),
    severity_text: isOk ? "INFO" : "WARN",
    severity_number: isOk ? 9 : 13,
    event_name: "classifier-telemetry.tool.verdict",
    attributes: {
      tool_use_id: record.tool_use_id,
      agent_id: record.agent_id,
      tool: record.tool,
      interactive: INTERACTIVE.has(record.tool),
      decision: record.decision,
      rule: record.rule,
      hook: null,
      reason: record.reason,
      started_at: record.started_at,
      check_ms: record.check_ms,
      outcome: record.outcome,
      duration_ms: record.duration_ms,
      "session.id": record.session_id,
    },
    resource: { "service.name": "claude-code" },
    scope: { name: "classifier-telemetry" },
  };
}

function parse(text: string): LegacyRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  const parsed = LegacyRecord.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function compactSession(source: string, target: string, dryRun: boolean): Promise<Totals> {
  const out = Bun.file(join(target, OUT));
  if (await out.exists()) return { sessions: 0, skipped: 1, records: 0, unreadable: 0 };
  const files = (await readdir(source)).filter((f) => f.endsWith(".json"));
  const records = await Promise.all(
    files.map(async (f) => parse(await Bun.file(join(source, f)).text())),
  );
  const lines = records
    .flatMap((r) => (r === undefined ? [] : [JSON.stringify(toEvent(r))]))
    .toSorted();
  if (!dryRun && lines.length > 0)
    await Bun.write(out, `${lines.join("\n")}\n`, { createPath: true });
  return {
    sessions: 1,
    skipped: 0,
    records: lines.length,
    unreadable: files.length - lines.length,
  };
}

/**
 * Writes each legacy session directory's records as one mod-events JSONL file,
 * skipping sessions already compacted. The legacy files stay in place.
 */
export async function compact(source: string, target: string, dryRun = false): Promise<Totals> {
  const sessions = (await readdir(source, { withFileTypes: true })).filter((d) => d.isDirectory());
  const results = await Promise.all(
    sessions.map((d) => compactSession(join(source, d.name), join(target, d.name), dryRun)),
  );
  const totals: Totals = { sessions: 0, skipped: 0, records: 0, unreadable: 0 };
  for (const r of results) {
    totals.sessions += r.sessions;
    totals.skipped += r.skipped;
    totals.records += r.records;
    totals.unreadable += r.unreadable;
  }
  return totals;
}

if (import.meta.main) {
  const config = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const program = new Command()
    .description("Compact classifier-telemetry's per-call records into mod-events JSONL")
    .option("--source <dir>", "legacy records", join(config, "classifier-telemetry"))
    .option("--target <dir>", "mod-events root", join(config, "mod-events"))
    .option("--dry-run", "count without writing", false)
    .parse();
  const { source, target, dryRun } = program.opts();
  console.log(JSON.stringify(await compact(source, target, dryRun)));
}
