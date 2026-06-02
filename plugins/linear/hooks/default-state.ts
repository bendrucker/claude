#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { runHook } from "@bendrucker/claude-hook";

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

if (import.meta.main) {
  runHook(processInput, "linear/default-state");
}
