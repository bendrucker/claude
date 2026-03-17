#!/usr/bin/env bun

import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const pluginScriptsDir = join(import.meta.dirname, "..", "scripts") + "/";

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const toolInput = input.tool_input as Record<string, unknown>;
  const command = toolInput.command as string | undefined;
  if (!command?.includes(pluginScriptsDir)) return null;

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

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
