#!/usr/bin/env bun

import {
  type PostToolUseHookInput,
  postToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const command = (input.tool_input as { command?: string }).command;
  if (!command || !command.includes("glab")) return null;

  const response = JSON.stringify(input.tool_response ?? "");
  if (!response.includes("invalid_grant")) return null;

  return postToolUse.additionalContext(
    "glab OAuth token expired. Run: glab auth login --hostname gitlab.com --git-protocol ssh (requires dangerouslyDisableSandbox: true for browser OAuth flow)",
  );
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>((input) =>
    input.hook_event_name === "PostToolUse" ? processInput(input) : null,
  );
}
