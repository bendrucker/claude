#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson } from "@constellos/claude-code-kit/runners";
import { setState } from "./state";

type ToolInput = {
  file_path?: string;
};

export async function hasTrailingNewline(filePath: string): Promise<boolean | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  if (file.size === 0) {
    return null;
  }

  const content = await file.text();
  return content.endsWith("\n");
}

export async function processInput(input: PreToolUseHookInput): Promise<void> {
  const { file_path: filePath } = input.tool_input as ToolInput;
  if (!filePath) return;

  const hasNewline = await hasTrailingNewline(filePath);

  if (hasNewline === null) {
    await setState("newline", filePath, "");
  } else {
    await setState("newline", filePath, hasNewline ? "1" : "");
  }
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[newline/check] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    await processInput(input);
  } catch (error) {
    console.error(`[newline/check] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
