#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { $ } from "bun";

function formatOutput(reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

async function main(): Promise<void> {
  let _input: PreToolUseHookInput;
  try {
    _input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[git/conflicts/check-markers] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const result = await $`git diff --cached --check`.quiet().nothrow();

  if (result.exitCode !== 0) {
    const output = result.stderr.toString() || result.stdout.toString();
    const markers = output
      .split("\n")
      .filter((line) => line.includes("conflict marker"))
      .slice(0, 5)
      .join(", ");

    writeStdoutJson(
      formatOutput(
        `Conflict markers in staged files: ${markers || "run 'git diff --cached --check' for details"}`,
      ),
    );
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
