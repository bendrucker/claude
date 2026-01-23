#!/usr/bin/env npx tsx

import { existsSync, readFileSync, statSync } from "fs";
import { readStdinJson } from "@constellos/claude-code-kit/runners";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-code";
import { setState } from "./state.ts";

type ToolInput = {
  file_path?: string;
};

export function hasTrailingNewline(filePath: string): boolean | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const stat = statSync(filePath);
  if (stat.size === 0) {
    return null;
  }

  const content = readFileSync(filePath, "utf-8");
  return content.endsWith("\n");
}

export function processInput(input: PreToolUseHookInput): void {
  const { file_path: filePath } = input.tool_input as ToolInput;

  const hasNewline = hasTrailingNewline(filePath);

  if (hasNewline === null) {
    setState("newline", filePath, "");
  } else {
    setState("newline", filePath, hasNewline ? "1" : "");
  }
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[newline/check] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  try {
    processInput(input);
  } catch (error) {
    console.error(
      `[newline/check] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

main().catch(console.error);
