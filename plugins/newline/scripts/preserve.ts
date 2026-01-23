#!/usr/bin/env npx tsx

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { getState, clearState } from "./state";

type ToolInput = {
  file_path?: string;
};

export function preserveNewlineState(filePath: string, hadNewline: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const stat = statSync(filePath);
  if (stat.size === 0) {
    return "File is empty, skipping";
  }

  const content = readFileSync(filePath, "utf-8");
  const hasNewline = content.endsWith("\n");

  if (hadNewline === "1" && !hasNewline) {
    writeFileSync(filePath, `${content}\n`);
    return "Added trailing newline (preserving original state)";
  }

  if (hadNewline === "" && hasNewline) {
    writeFileSync(filePath, content.slice(0, -1));
    return "Removed trailing newline (preserving original state)";
  }

  return null;
}

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const { file_path: filePath } = input.tool_input as ToolInput;
  if (!filePath) return null;

  const hadNewline = getState("newline", filePath);
  const message = preserveNewlineState(filePath, hadNewline);

  clearState("newline", filePath);

  if (message) {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[newline/preserve] ${message}`,
      },
    };
  }

  return null;
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = await readStdinJson<PostToolUseHookInput>();
  } catch (error) {
    console.error(
      `[newline/preserve] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    const output = processInput(input);
    if (output) {
      writeStdoutJson(output);
    }
  } catch (error) {
    console.error(`[newline/preserve] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch(console.error);
