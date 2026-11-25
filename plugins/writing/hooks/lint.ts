#!/usr/bin/env bun

import type { PostToolUseHookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getExtension, isMemoryPath, isPlanPath, isScratchPath } from "../detection/paths";
import { lintFile, valeAlerts } from "../detection/vale";
import { type EditScope, editScopeOf, newAlerts } from "./edit-scope";
import { formatContext, isPlanMode, type SyncHookJSONOutput, toolInputOf } from "./io";
import { decisionOf, hookAlertOf, type HookAlert, MAX_REPORTED, report } from "./report";
import { appendRunLog, type RunLogEntry, type RunOutcome } from "./run-log";
import { recentlyFired, recordFired } from "./session-state";
import { detectChanges, type Lints, lintTargets } from "./worktree-changes";

export type HookInput = PreToolUseHookInput | PostToolUseHookInput;

export interface DispatchResult {
  output: SyncHookJSONOutput | null;
  log: RunLogEntry;
}

/** Correlates successive writes to one file without logging the path. */
export function targetOf(filePath: string): string {
  return createHash("sha256").update(filePath, "utf8").digest("hex").slice(0, 16);
}

// Alerts the file already raised before the edit are counted but not reported,
// since the model did not write them.
async function lintEdited(
  filePath: string,
  scope: EditScope | null,
): Promise<{ alerts: HookAlert[]; checks: string[]; unedited: number }> {
  // The pre-edit lint runs beside the saved one, since most edited files already raise an alert.
  const [all, before] = await Promise.all([
    lintFile(filePath),
    scope === null ? [] : valeAlerts(scope.original, { filePath }),
  ]);
  const edited = scope === null || all.length === 0 ? all : newAlerts(all, before, scope.added);
  return {
    alerts: edited.map((alert) => hookAlertOf(alert, decisionOf(alert.Severity, "PostToolUse"))),
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
  if (input.tool_use_id !== "") base.tool_use_id = input.tool_use_id;
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
      // The message linter loads tree-sitter, which a file edit never needs.
      const { lintMessages } = await import("./messages");
      alerts = await lintMessages(input);
      checks = unique(alerts.map((alert) => alert.check));
    } else if (hasPath) {
      ({ alerts, checks, unedited } = await lintEdited(filePath, editScopeOf(input.tool_response)));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[writing/lint] Vale failed: ${message}`);
    return finish(null, "error", { vale_error: message });
  }
  const scoped: Partial<RunLogEntry> =
    unedited > 0 ? { checks, unedited_alerts: unedited } : { checks };
  if (alerts.length === 0) return finish(null, "silent", scoped);

  const { kept, muted } = await unmuted(alerts, input.session_id, base.target, now);

  const extra = scoped;
  if (muted.size > 0) extra.suppressed_checks = [...muted];
  const result = report(kept, { event: input.hook_event_name, filePath });
  if (!result) {
    extra.check = [...muted][0];
    extra.suppressed = true;
    return finish(null, "silent", extra);
  }

  const emitted = unique(result.shown.map((alert) => alert.check));
  await recordAll(emitted, input.session_id, base.target, now);
  return finish(result.output, result.decision, { ...extra, check: emitted[0], emitted });
}

// Repeats are muted per file, so an alert left in one file does not hide the same check in another.
function keyOf(check: string, target: string | undefined): string {
  return target === undefined ? check : `${target}:${check}`;
}

async function unmuted(
  alerts: HookAlert[],
  sessionId: string,
  target: string | undefined,
  now: number,
): Promise<{ kept: HookAlert[]; muted: Set<string> }> {
  const muted = new Set<string>();
  const kept: HookAlert[] = [];
  for (const alert of alerts) {
    if (alert.decision === "context") {
      if (muted.has(alert.check)) continue;
      // oxlint-disable-next-line no-await-in-loop -- reads one small state file per check, and the loop is bounded by the checks found.
      if (await recentlyFired(sessionId, keyOf(alert.check, target), now)) {
        muted.add(alert.check);
        continue;
      }
    }
    kept.push(alert);
  }
  return { kept, muted };
}

async function recordAll(
  checks: string[],
  sessionId: string,
  target: string | undefined,
  now: number,
): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- sequential writes to one state file; concurrent read-modify-write would drop checks.
  for (const check of checks) await recordFired(sessionId, keyOf(check, target), now);
}

export interface BashDispatchResult {
  output: SyncHookJSONOutput | null;
  logs: RunLogEntry[];
}

// A Bash call can write several files, so it logs a row per changed file and reports them in one output.
/** Lint the lines a Bash call added to files in the cwd's repo, against the snapshot taken before the call. */
export async function dispatchBash(
  input: PostToolUseHookInput,
  now: number = Date.now(),
  lints: Lints = lintTargets(input.cwd),
): Promise<BashDispatchResult> {
  if (isPlanMode(input)) return { output: null, logs: [] };
  const start = performance.now();
  const detection = await detectChanges(input.session_id, input.cwd, lints);
  if (detection.status !== "changed") return { output: null, logs: [] };

  const sections: string[] = [];
  const logs: RunLogEntry[] = [];
  let budget = MAX_REPORTED;
  for (const file of detection.files) {
    const target = targetOf(file.path);
    const row: RunLogEntry = {
      ts: new Date(now).toISOString(),
      session_id: input.session_id,
      event: "PostToolUse",
      tool: input.tool_name,
      ext: getExtension(file.path),
      target,
      duration_ms: 0,
      outcome: "silent",
    };
    if (input.tool_use_id !== "") row.tool_use_id = input.tool_use_id;
    logs.push(row);
    let linted: Awaited<ReturnType<typeof lintEdited>>;
    try {
      // oxlint-disable-next-line no-await-in-loop -- files share one repeat-suppression state file, so they lint in turn.
      linted = await lintEdited(file.path, file);
    } catch (error) {
      row.outcome = "error";
      row.vale_error = error instanceof Error ? error.message : String(error);
      continue;
    }
    row.checks = linted.checks;
    if (linted.unedited > 0) row.unedited_alerts = linted.unedited;
    // oxlint-disable-next-line no-await-in-loop -- see above.
    const { kept, muted } = await unmuted(linted.alerts, input.session_id, target, now);
    if (muted.size > 0) row.suppressed_checks = [...muted];
    const result =
      budget > 0
        ? report(kept, { event: "PostToolUse", filePath: file.path, limit: budget })
        : null;
    if (result === null) continue;
    const emitted = unique(result.shown.map((alert) => alert.check));
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await recordAll(emitted, input.session_id, target, now);
    budget -= result.shown.length;
    sections.push(result.text);
    Object.assign(row, { outcome: "context", check: emitted[0], emitted });
  }
  const duration = Math.round(performance.now() - start);
  for (const row of logs) row.duration_ms = duration;
  const output = sections.length === 0 ? null : formatContext("PostToolUse", sections.join("\n\n"));
  return { output, logs };
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

  const { output, logs } =
    input.hook_event_name === "PostToolUse" && input.tool_name === "Bash"
      ? await dispatchBash(input)
      : await dispatch(input).then((result) => ({ output: result.output, logs: [result.log] }));
  for (const log of logs) appendRunLog(log);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
