#!/usr/bin/env npx tsx

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type BashInput = {
  command?: string;
};

const REPLACED_SUBCOMMANDS = new Set(["add", "list", "remove"]);

export function formatDenyOutput(subcommand: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Use the worktrunk skill (/worktrunk) instead of \`git worktree ${subcommand}\`.`,
    },
  };
}

export function formatAskOutput(): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "Prefer the worktrunk skill (/worktrunk) over `git worktree`. Continue only if worktrunk does not support this operation.",
    },
  };
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const command = (input.tool_input as BashInput).command;
  if (!command) {
    return null;
  }

  const match = command.match(/\bgit\s+worktree\s+(\w+)/);
  if (!match) {
    return null;
  }

  const subcommand = match[1];
  if (REPLACED_SUBCOMMANDS.has(subcommand)) {
    return formatDenyOutput(subcommand);
  }

  return formatAskOutput();
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[worktree] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
