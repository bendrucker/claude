#!/usr/bin/env npx tsx

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type BashInput = {
  command?: string;
};

const READ_ONLY_SUBCOMMANDS = new Set(["list"]);
const REPLACED_SUBCOMMANDS = new Set(["add", "remove"]);
const TMP_TARGET = /^(\.\/)?tmp\//;

export function isThrowawayAdd(command: string): boolean {
  const after = command.split(/\bgit\s+worktree\s+add\b/)[1];
  if (after === undefined) return false;
  return after.split(/\s+/).some((tok) => TMP_TARGET.test(tok));
}

export function formatDenyOutput(subcommand: string): SyncHookJSONOutput {
  const base = `Use the worktrunk skill (/worktrunk) instead of \`git worktree ${subcommand}\`.`;
  const reason =
    subcommand === "add"
      ? `${base} For a throwaway verification checkout, add it under \`tmp/\`.`
      : base;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
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
  const subcommand = match?.[1];
  if (!subcommand) {
    return null;
  }
  if (READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return null;
  }
  if (subcommand === "add" && isThrowawayAdd(command)) {
    return null;
  }
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

if (import.meta.main) {
  main().catch(console.error);
}
