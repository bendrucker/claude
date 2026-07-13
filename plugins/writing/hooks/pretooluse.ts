#!/usr/bin/env bun

import { type PreToolUseHookInput, runHook } from "@bendrucker/claude-plugin-toolkit";
import { getExtension, isMemoryPath, isPlanPath, isScratchPath } from "../detection/paths";
import * as tropes from "./check-tropes";
import * as headings from "./headings";
import { type HookResult, isPlanMode, type SyncHookJSONOutput, tierOf } from "./io";
import * as numbering from "./numbering";
import { appendRunLog, type RunLogEntry, type RunOutcome } from "./run-log";
import { recentlyFired, recordFired } from "./session-state";

const FILE_OP_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

const TIER_RANK = { deny: 0, ask: 1, context: 2 } as const;

export type DispatchResult = {
  output: SyncHookJSONOutput | null;
  log: RunLogEntry;
};

function filePathOf(input: PreToolUseHookInput): string | undefined {
  if (!FILE_OP_TOOLS.has(input.tool_name)) return undefined;
  const filePath = (input.tool_input as Record<string, unknown>).file_path;
  return typeof filePath === "string" ? filePath : undefined;
}

// One dispatcher run sequences all checkers in-process and emits at most one
// output. Priority is deny > ask > context, and within a tier the earliest
// checker in numbering → headings → tropes order wins.
export async function dispatch(
  input: PreToolUseHookInput,
  now: number = Date.now(),
): Promise<DispatchResult> {
  const start = performance.now();
  const filePath = filePathOf(input);

  const base = {
    ts: new Date(now).toISOString(),
    session_id: input.session_id,
    tool: input.tool_name,
    ext: filePath ? getExtension(filePath) : "",
  };

  const finish = (
    output: SyncHookJSONOutput | null,
    outcome: RunOutcome,
    extra: Partial<RunLogEntry> = {},
  ): DispatchResult => ({
    output,
    log: { ...base, duration_ms: Math.round(performance.now() - start), outcome, ...extra },
  });

  if (isPlanMode(input)) return finish(null, "silent");
  if (filePath && isScratchPath(filePath, input.cwd)) return finish(null, "skipped-scratch");
  if (filePath && (isPlanPath(filePath) || isMemoryPath(filePath))) return finish(null, "silent");

  const mode: numbering.Mode = input.tool_name === "Edit" ? "edit" : "write";
  const checkers = [
    () => numbering.check(input, mode),
    () => headings.check(input),
    () => tropes.check(input),
  ];

  // One checker crashing must not take down the others or the run log.
  const results: HookResult[] = [];
  for (const checker of checkers) {
    try {
      const result = await checker();
      if (result) results.push(result);
    } catch (error) {
      console.error(
        `[writing/pretooluse] checker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (results.length === 0) return finish(null, "silent");

  // Stable sort: within a tier the earliest checker keeps priority. A
  // suppressed winner falls through to the next result rather than muting
  // findings whose categories never fired.
  const ordered = [...results].sort(
    (a, b) => TIER_RANK[tierOf(a.output)] - TIER_RANK[tierOf(b.output)],
  );
  let suppressed: HookResult | undefined;
  for (const result of ordered) {
    const tier = tierOf(result.output);
    if (tier === "context" && result.suppressible !== false) {
      if (await recentlyFired(input.session_id, result.category, now)) {
        suppressed ??= result;
        continue;
      }
      await recordFired(input.session_id, result.category, now);
    }
    return finish(result.output, tier, { category: result.category });
  }
  return finish(
    null,
    "silent",
    suppressed ? { category: suppressed.category, suppressed: true } : {},
  );
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(async (input) => {
    const { output, log } = await dispatch(input);
    appendRunLog(log);
    return output;
  });
}
