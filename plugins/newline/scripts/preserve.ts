#!/usr/bin/env bun

import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { isMemoryPath } from "./memory-path";
import { clearState, getState } from "./state";

type ToolInput = {
  file_path?: string;
};

export async function preserveNewlineState(
  filePath: string,
  hadNewline: string,
): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  if (file.size === 0) {
    return "File is empty, skipping";
  }

  const content = await file.text();
  const hasNewline = content.endsWith("\n");

  if (hadNewline === "1" && !hasNewline) {
    await Bun.write(filePath, `${content}\n`);
    return "Added trailing newline (preserving original state)";
  }

  if (hadNewline === "" && hasNewline) {
    await Bun.write(filePath, content.slice(0, -1));
    return "Removed trailing newline (preserving original state)";
  }

  return null;
}

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  const { file_path: filePath } = input.tool_input as ToolInput;
  if (!filePath) return null;
  if (isMemoryPath(filePath)) return null;

  const hadNewline = await getState("newline", filePath);
  const message = await preserveNewlineState(filePath, hadNewline);

  await clearState("newline", filePath);

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
    input = JSON.parse(await Bun.stdin.text()) as PostToolUseHookInput;
  } catch (error) {
    console.error(
      `[newline/preserve] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    const output = await processInput(input);
    if (output) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch (error) {
    console.error(`[newline/preserve] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
