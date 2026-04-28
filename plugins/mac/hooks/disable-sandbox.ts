#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput {
  const toolInput = input.tool_input as Record<string, unknown>;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, dangerouslyDisableSandbox: true },
    },
  };
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch {
    return;
  }

  writeStdoutJson(processInput(input));
}

if (import.meta.main) {
  main().catch(console.error);
}
