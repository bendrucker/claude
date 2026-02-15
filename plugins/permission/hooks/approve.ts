#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "LS"]);

const SAFE_BASH_PREFIXES = [
  "bun test",
  "npm test",
  "npx vitest",
  "npx jest",
  "pytest",
  "go test",
  "make test",
  "cargo test",
];

function allow(): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  };
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const toolName = input.tool_name;

  if (READ_ONLY_TOOLS.has(toolName)) {
    return allow();
  }

  if (toolName === "Bash") {
    const command = (input.tool_input as { command?: string })?.command;
    if (typeof command === "string") {
      const trimmed = command.trimStart();
      if (
        SAFE_BASH_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `))
      ) {
        return allow();
      }
    }
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[permission/approve] Failed to parse hook input: ${message}`);
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `[permission/approve] Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
