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
  const toolInput = input.tool_input as CreateIssueInput & Record<string, unknown>;
  const { id, state, assignee } = toolInput;

  // An id means this is an update (claude.ai save_issue handles both);
  // never inject a default state into updates.
  if (id || state) {
    return null;
  }
  const defaultState = getDefaultState(assignee);

  // updatedInput is applied only when permissionDecision is "allow"; the
  // harness ignores it otherwise. "allow" also bypasses the permission
  // prompt for the call, a cost we accept to inject the default state.
  // updatedInput replaces the entire input object, so echo back every
  // original field alongside the injected state.
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        ...toolInput,
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
