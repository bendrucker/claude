#!/usr/bin/env bun

import type { PostToolUseHookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getExtension, isMemoryPath, isPlanPath, isScratchPath } from "../detection/paths";
import { lintFile } from "../detection/vale";
import { editedAlerts, editScopeOf } from "./edit-scope";
import { isPlanMode, type SyncHookJSONOutput, toolInputOf } from "./io";
import { lintMessages } from "./messages";
import { hookAlertOf, type HookAlert, report } from "./report";
import { appendRunLog, type RunLogEntry, type RunOutcome } from "./run-log";
import { recentlyFired, recordFired } from "./session-state";

export type HookInput = PreToolUseHookInput | PostToolUseHookInput;

export interface DispatchResult {
  output: SyncHookJSONOutput | null;
  log: RunLogEntry;
}

/** Correlates successive writes to one file without logging the path. */
export function targetOf(filePath: string): string {
  return createHash("sha256").update(filePath, "utf8").digest("hex").slice(0, 16);
}

// Alerts on lines the edit left alone are counted but not reported, since the
// model did not write them.
async function lintEdited(
  filePath: string,
  toolResponse: unknown,
): Promise<{ alerts: HookAlert[]; checks: string[]; unedited: number }> {
  const all = await lintFile(filePath);
  const scope = editScopeOf(toolResponse);
  const edited = scope === null ? all : editedAlerts(all, scope);
  return {
    alerts: edited.map((alert) => hookAlertOf(alert, "context")),
    checks: unique(all.map((alert) => alert.Check)),
    unedited: all.length - edited.length,
  };
}

// One run emits every alert in one output, so the model fixes them in a
// single pass instead of a retry per alert.
export async function dispatch(
  input: HookInput,
  now: number = Date.now(),
): Promise<DispatchResult> {
  const start = performance.now();
  const filePath =
    input.hook_event_name === "PostToolUse" ? toolInputOf(input).file_path : undefined;
  const hasPath = filePath !== undefined && filePath !== "";

  const base: Omit<RunLogEntry, "duration_ms" | "outcome"> = {
    ts: new Date(now).toISOString(),
    session_id: input.session_id,
    event: input.hook_event_name,
    tool: input.tool_name,
    ext: hasPath ? getExtension(filePath) : "",
  };
  if (hasPath) base.target = targetOf(filePath);

  const finish = (
    output: SyncHookJSONOutput | null,
    outcome: RunOutcome,
    extra: Partial<RunLogEntry> = {},
  ): DispatchResult => ({
    output,
    log: { ...base, duration_ms: Math.round(performance.now() - start), outcome, ...extra },
  });

  if (isPlanMode(input)) return finish(null, "silent");
  if (input.hook_event_name === "PostToolUse" && !hasPath) return finish(null, "silent");
  if (hasPath && isScratchPath(filePath, input.cwd)) return finish(null, "skipped-scratch");
  if (hasPath && (isPlanPath(filePath) || isMemoryPath(filePath))) return finish(null, "silent");

  // A failed lint is logged without `checks`, so it never reads as a clean run.
  let alerts: HookAlert[] = [];
  // Every check in the saved file, including those an edit left alone, so a
  // re-lint tells the health report whether an earlier alert was fixed.
  let checks: string[] = [];
  let unedited = 0;
  try {
    if (input.hook_event_name === "PreToolUse") {
      alerts = await lintMessages(input);
      checks = unique(alerts.map((alert) => alert.check));
    } else if (hasPath) {
      ({ alerts, checks, unedited } = await lintEdited(filePath, input.tool_response));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[writing/lint] Vale failed: ${message}`);
    return finish(null, "error", { vale_error: message });
  }
  const scoped: Partial<RunLogEntry> =
    unedited > 0 ? { checks, unedited_alerts: unedited } : { checks };
  if (alerts.length === 0) return finish(null, "silent", scoped);

  // Repeats are muted per file, so an alert left in one file does not hide the same check in another.
  const key = (check: string): string =>
    base.target === undefined ? check : `${base.target}:${check}`;
  const muted = new Set<string>();
  const kept: HookAlert[] = [];
  for (const alert of alerts) {
    if (alert.decision === "context") {
      if (muted.has(alert.check)) continue;
      // oxlint-disable-next-line no-await-in-loop -- reads one small state file per check, and the loop is bounded by the checks found.
      if (await recentlyFired(input.session_id, key(alert.check), now)) {
        muted.add(alert.check);
        continue;
      }
    }
    kept.push(alert);
  }

  const extra: Partial<RunLogEntry> = { ...scoped };
  if (muted.size > 0) extra.suppressed_checks = [...muted];
  const result = report(kept, { event: input.hook_event_name, filePath });
  if (!result) {
    extra.check = [...muted][0];
    extra.suppressed = true;
    return finish(null, "silent", extra);
  }

  const emitted = unique(result.shown.map((alert) => alert.check));
  // oxlint-disable-next-line no-await-in-loop -- sequential writes to one state file; concurrent read-modify-write would drop checks.
  for (const check of emitted) await recordFired(input.session_id, key(check), now);
  return finish(result.output, result.decision, { ...extra, check: emitted[0], emitted });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const Common = {
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  permission_mode: z.string().catch(""),
  tool_name: z.string(),
  tool_input: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
};

const HookInput = z.discriminatedUnion("hook_event_name", [
  z.looseObject({ hook_event_name: z.literal("PreToolUse"), ...Common }),
  z.looseObject({
    hook_event_name: z.literal("PostToolUse"),
    tool_response: z.unknown().catch(undefined),
    ...Common,
  }),
]) satisfies z.ZodType<HookInput>;

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[writing/lint] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const { output, log } = await dispatch(input);
  appendRunLog(log);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
