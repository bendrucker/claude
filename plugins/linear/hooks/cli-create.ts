#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { getDefaultState } from "./save-issue";

const SHELL_OPERATORS = /\s*(?:&&|\|\||[|;])\s*/;
const ENV_PREFIX = /^(?:[A-Za-z_]\w*=\S*\s+)*/;
const SUBSTITUTION = /\$\(|`|\n/;

// `linear issue create` preceded by a shell boundary, so `foo-linear issue
// create` and a quoted title containing the phrase do not match.
const CREATE = /(^|[\s;&|("'])linear\s+issue\s+create(\s|$)/;
const LEADING_CREATE = /^linear\s+issue\s+create(\s|$)/;

// --start self-assigns and moves the issue to a started state right after
// create, so it supplies a state of its own.
const HAS_STATE = /(^|\s)(-s|--state)([=\s]|$)/;
const HAS_START = /(^|\s)--start(\s|$)/;
const ASSIGNEE = /(?:^|\s)(?:-a|--assignee)[=\s]+(\S+)/;

export function isSingleInvocation(command: string): boolean {
  if (SUBSTITUTION.test(command)) return false;
  const segments = command.split(SHELL_OPERATORS);
  if (segments.length !== 1) return false;
  return LEADING_CREATE.test(command.trim().replace(ENV_PREFIX, ""));
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { command } = input.tool_input as { command?: string };
  if (!command || !CREATE.test(command)) return null;
  if (HAS_STATE.test(command) || HAS_START.test(command)) return null;

  const state = getDefaultState(command.match(ASSIGNEE)?.[1]);

  // In a compound command, an appended flag lands on the last segment, so hand
  // the fix back for the author to place.
  if (!isSingleInvocation(command)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `\`linear issue create\` without \`--state\` lands the issue in Triage. Add \`--state ${state}\` to the create command.`,
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: `${command.trimEnd()} --state ${state}` },
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[linear/cli-create] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
