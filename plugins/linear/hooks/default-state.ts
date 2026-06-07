#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type CreateIssueInput = {
  id?: string;
  title?: string;
  team?: string;
  state?: string;
  assignee?: string;
};

export function getDefaultState(assignee: string | undefined): string {
  return assignee ? "Todo" : "Backlog";
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { id, state, assignee } = input.tool_input as CreateIssueInput;

  // An id means this is an update (claude.ai save_issue handles both);
  // never inject a default state into updates.
  if (id || state) {
    return null;
  }
  const defaultState = getDefaultState(assignee);

  // updatedInput is only honored alongside permissionDecision: "allow";
  // without it the harness ignores the modification entirely.
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        state: defaultState,
      },
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[linear/default-state] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
