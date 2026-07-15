#!/usr/bin/env bun

import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const command = (input.tool_input as { command?: string }).command;
  if (!command || !command.includes("glab")) return null;

  const response = JSON.stringify(input.tool_response ?? "");
  if (!response.includes("invalid_grant")) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "glab OAuth token expired. Run: glab auth login --hostname gitlab.com --git-protocol ssh (requires dangerouslyDisableSandbox: true for browser OAuth flow)",
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PostToolUseHookInput;
  } catch {
    return;
  }

  if (input.hook_event_name !== "PostToolUse") return;

  const output = processInput(input);
  if (output) {
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
