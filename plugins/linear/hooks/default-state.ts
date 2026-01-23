#!/usr/bin/env npx tsx

import type {
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-code";

export type CreateIssueInput = {
  title?: string;
  team?: string;
  state?: string;
  assignee?: string;
};

export function getDefaultState(assignee: string | undefined): string {
  return assignee ? "Todo" : "Backlog";
}

export function processInput(
  input: PreToolUseHookInput
): SyncHookJSONOutput | null {
  const toolInput = input.tool_input as CreateIssueInput | undefined;
  const state = toolInput?.state;

  // Only modify if state is not set
  if (state) {
    return null;
  }

  const assignee = toolInput?.assignee || undefined;
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
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const inputText = Buffer.concat(chunks).toString("utf-8");

  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(inputText) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[linear/default-state] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    console.log(JSON.stringify(output));
  }
}

main().catch(console.error);
