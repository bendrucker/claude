#!/usr/bin/env bun

import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { filePathOf, PreToolUse } from "./hook-input";
import { isMemoryPath } from "./memory-path";
import { setState } from "./state";

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
  const filePath = filePathOf(input.tool_input);
  if (filePath == null || filePath === "") return;
  if (isMemoryPath(filePath)) return;

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
    input = PreToolUse.parse(JSON.parse(await Bun.stdin.text()));
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
