#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  getExtension,
  isMarkdownFile,
  isMemoryPath,
  isPlanPath,
  isScratchPath,
} from "../detection/paths";
import * as tropes from "./check-tropes";
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

// Every heading check is markdown-only: `headings.check` returns null for any
// other extension and for the Bash surface, which is most of what this hook
// sees. Its module graph is not free, though. It reaches an AP title-case
// library, the heading classifier, and the markdown parser, together the
// largest block of the ~40ms this dispatcher spent parsing modules before it
// could read its input. Loading it from the markdown branch is the only way to
// keep a runtime-conditional graph out of an unconditional import.
async function headingResult(input: PreToolUseHookInput): Promise<HookResult | null> {
  const headings = await import("./headings");
  return headings.check(input);
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
  const ext = filePath ? getExtension(filePath) : "";

  const base = {
    ts: new Date(now).toISOString(),
    session_id: input.session_id,
    tool: input.tool_name,
    ext,
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
    () => (isMarkdownFile(ext) ? headingResult(input) : null),
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
  const ordered = results.toSorted(
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

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
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
