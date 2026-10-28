#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getExtension, isMemoryPath, isPlanPath, isScratchPath } from "../detection/paths";
import { check as checkTropes } from "./check-tropes";
import { isPlanMode, type SyncHookJSONOutput, toolInputOf } from "./io";
import { type HookFinding, report } from "./report";
import { appendRunLog, type RunLogEntry, type RunOutcome } from "./run-log";
import { recentlyFired, recordFired } from "./session-state";

const FILE_OP_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

export interface DispatchResult {
  output: SyncHookJSONOutput | null;
  log: RunLogEntry;
}

function filePathOf(input: PreToolUseHookInput): string | undefined {
  if (!FILE_OP_TOOLS.has(input.tool_name)) return undefined;
  return toolInputOf(input).file_path;
}

/** Correlates successive writes to one file without logging the path. */
export function targetOf(filePath: string): string {
  return createHash("sha256").update(filePath, "utf8").digest("hex").slice(0, 16);
}

// One dispatcher run sequences all checkers in-process and emits every finding
// in one output, so the model fixes them in a single pass instead of a retry
// per finding.
export async function dispatch(
  input: PreToolUseHookInput,
  now: number = Date.now(),
): Promise<DispatchResult> {
  const start = performance.now();
  const filePath = filePathOf(input);
  const ext = filePath != null && filePath !== "" ? getExtension(filePath) : "";

  const base: Omit<RunLogEntry, "duration_ms" | "outcome"> = {
    ts: new Date(now).toISOString(),
    session_id: input.session_id,
    tool: input.tool_name,
    ext,
  };
  if (filePath != null && filePath !== "") base.target = targetOf(filePath);

  const finish = (
    output: SyncHookJSONOutput | null,
    outcome: RunOutcome,
    extra: Partial<RunLogEntry> = {},
  ): DispatchResult => ({
    output,
    log: { ...base, duration_ms: Math.round(performance.now() - start), outcome, ...extra },
  });

  if (isPlanMode(input)) return finish(null, "silent");
  if (filePath != null && filePath !== "" && isScratchPath(filePath, input.cwd))
    return finish(null, "skipped-scratch");
  if (filePath != null && filePath !== "" && (isPlanPath(filePath) || isMemoryPath(filePath)))
    return finish(null, "silent");

  // A crashing checker must not take down the run log.
  const findings: HookFinding[] = [];
  try {
    findings.push(...(await checkTropes(input)));
  } catch (error) {
    console.error(
      `[writing/pretooluse] checker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // `checks` records what the checkers found, which is what a later run on
  // the same target is compared against. It is set only past this point: an
  // earlier return means the checkers never ran, and an absent list must not
  // read as a clean run.
  const checks = unique(findings.map((finding) => finding.check));
  if (findings.length === 0) return finish(null, "silent", { checks });

  const muted = new Set<string>();
  const kept: HookFinding[] = [];
  for (const finding of findings) {
    if (finding.tier === "context" && finding.introduced !== true) {
      if (muted.has(finding.check)) continue;
      // oxlint-disable-next-line no-await-in-loop -- reads one small state file per check, and the loop is bounded by the checks found.
      if (await recentlyFired(input.session_id, finding.check, now)) {
        muted.add(finding.check);
        continue;
      }
    }
    kept.push(finding);
  }

  const extra: Partial<RunLogEntry> = { checks };
  if (muted.size > 0) extra.suppressed_checks = [...muted];
  const result = report(kept, { toolName: input.tool_name, filePath });
  if (!result) {
    extra.check = [...muted][0];
    extra.suppressed = true;
    return finish(null, "silent", extra);
  }

  const emitted = unique(result.shown.map((finding) => finding.check));
  // oxlint-disable-next-line no-await-in-loop -- sequential writes to one state file; concurrent read-modify-write would drop checks.
  for (const check of emitted) await recordFired(input.session_id, check, now);
  return finish(result.output, result.tier, { ...extra, check: emitted[0], emitted });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const HookInput = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  permission_mode: z.string().catch(""),
  tool_name: z.string(),
  tool_input: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
}) satisfies z.ZodType<PreToolUseHookInput>;

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[writing/pretooluse] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
