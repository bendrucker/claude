#!/usr/bin/env bun

import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const response = String(input.tool_response ?? "");

  if (!response.includes("Request failed with status code 404")) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "WebFetch returned 404. The URL may not exist or may have moved. Use WebSearch to find the correct URL before retrying.",
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = await readStdinJson<PostToolUseHookInput>();
  } catch (error) {
    console.error(
      `[webfetch-404] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
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
