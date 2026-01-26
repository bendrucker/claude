#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export type CreateIssueInput = {
  title?: string;
  team?: string;
  state?: string;
  assignee?: string;
};

export function getDefaultState(assignee: string | undefined): string {
  return assignee ? "Todo" : "Backlog";
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { state, assignee } = input.tool_input as CreateIssueInput;

  // Only modify if state is not set
  if (state) {
    return null;
  }
  const defaultState = getDefaultState(assignee);

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
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

main().catch(console.error);
