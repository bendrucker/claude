#!/usr/bin/env bun

import { join, resolve } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

type BashInput = { command: string };

const scriptsDir = resolve(join(import.meta.dirname, "..", "scripts"));

function disableSandbox(toolInput: Record<string, unknown>): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, dangerouslyDisableSandbox: true },
    },
  };
}

export function processInput(
  input: PreToolUseHookInput,
  scriptsPath = scriptsDir,
): SyncHookJSONOutput | null {
  const toolInput = input.tool_input as Record<string, unknown>;
  const { command } = toolInput as BashInput;
  if (!command) return null;

  if (command.includes(scriptsPath)) {
    return disableSandbox(toolInput);
  }

  return null;
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
