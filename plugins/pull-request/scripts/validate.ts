#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { processInput } from "./validate-body";

function denyWithError(reason: string): void {
  writeStdoutJson({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } satisfies SyncHookJSONOutput);
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Failed to parse hook input: ${message}`);
    denyWithError(`Validation hook failed to parse input: ${message}`);
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pull-request/validate] Unexpected error: ${message}`);
  denyWithError(`Validation hook encountered an error: ${message}`);
});
