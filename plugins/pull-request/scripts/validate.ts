#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./validate-body";

function denyWithError(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } satisfies SyncHookJSONOutput;
  process.stdout.write(JSON.stringify(output) + "\n");
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Failed to parse hook input: ${message}`);
    denyWithError(`Validation hook failed to parse input: ${message}`);
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pull-request/validate] Unexpected error: ${message}`);
  denyWithError(`Validation hook encountered an error: ${message}`);
});
