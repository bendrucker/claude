#!/usr/bin/env npx tsx

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { timeHook } from "../../scripts/hook-metrics";

export type BashInput = {
  command?: string;
};

const ALLOWED_SUBCOMMANDS = new Set(["list", "prune", "unlock"]);
const REPLACED_SUBCOMMANDS = new Set(["add", "remove"]);
const TMP_TARGET = /(^|\/)tmp\//;
const UNEXPANDED_VAR_TARGET = /^\$\{?\w+\}?\//;
const AGENT_WORKTREE_TARGET = /(^|\/)\.worktrees\//;

function isExemptTarget(token: string): boolean {
  return TMP_TARGET.test(token) || UNEXPANDED_VAR_TARGET.test(token);
}

export function isThrowawayAdd(command: string): boolean {
  const after = command.split(/\bgit\s+worktree\s+add\b/)[1];
  if (after === undefined) return false;
  return after.split(/\s+/).some(isExemptTarget);
}

export function isThrowawayRemove(command: string): boolean {
  const after = command.split(/\bgit\s+worktree\s+remove\b/)[1];
  if (after === undefined) return false;
  return after.split(/\s+/).some((tok) => isExemptTarget(tok) || AGENT_WORKTREE_TARGET.test(tok));
}

export function formatDenyOutput(subcommand: string): SyncHookJSONOutput {
  const base = `Use the worktrunk skill (/worktrunk) instead of \`git worktree ${subcommand}\`.`;
  const reason =
    subcommand === "add"
      ? `${base} For a throwaway verification checkout, add it under \`tmp/\`.`
      : subcommand === "remove"
        ? `${base} Throwaway worktrees under \`tmp/\` or \`.worktrees/\` may be removed directly.`
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
  if (ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return null;
  }
  if (subcommand === "add" && isThrowawayAdd(command)) {
    return null;
  }
  if (subcommand === "remove" && isThrowawayRemove(command)) {
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
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[worktree] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await timeHook("worktree", input, () => processInput(input));
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
