#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { PreToolUse } from "../../../scripts/hook-input";

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
  try {
    PreToolUse.parse(JSON.parse(await Bun.stdin.text()));
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

    const denial = formatOutput(
      `Conflict markers in staged files: ${markers || "run 'git diff --cached --check' for details"}`,
    );
    process.stdout.write(`${JSON.stringify(denial)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
