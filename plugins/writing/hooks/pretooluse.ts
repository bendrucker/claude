#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
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
  if (filePath && isScratchPath(filePath)) return finish(null, "skipped-scratch");
  if (filePath && (isPlanPath(filePath) || isMemoryPath(filePath))) return finish(null, "silent");

  const mode: numbering.Mode = input.tool_name === "Edit" ? "edit" : "write";
  const checkers = [
    () => numbering.check(input, mode),
    async () => headings.check(input),
    () => tropes.check(input),
  ];

  const results: HookResult[] = [];
  for (const checker of checkers) {
    const result = await checker();
    if (result) results.push(result);
  }
  if (results.length === 0) return finish(null, "silent");

  let winner = results[0] as HookResult;
  for (const result of results.slice(1)) {
    if (TIER_RANK[tierOf(result.output)] < TIER_RANK[tierOf(winner.output)]) {
      winner = result;
    }
  }

  const tier = tierOf(winner.output);
  if (tier === "context") {
    if (await recentlyFired(input.session_id, winner.category, now)) {
      return finish(null, "silent", { category: winner.category, suppressed: true });
    }
    await recordFired(input.session_id, winner.category, now);
  }

  return finish(winner.output, tier, { category: winner.category });
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[writing/pretooluse] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const { output, log } = await dispatch(input);
  appendRunLog(log);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
