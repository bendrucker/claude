#!/usr/bin/env bun

import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { filePathOf, PostToolUse } from "./hook-input";
import { isMemoryPath } from "./memory-path";
import { clearState, getState } from "./state";

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
  const filePath = filePathOf(input.tool_input);
  if (filePath == null || filePath === "") return null;
  if (isMemoryPath(filePath)) return null;

  const hadNewline = await getState("newline", filePath);
  const message = await preserveNewlineState(filePath, hadNewline);

  await clearState("newline", filePath);

  if (message != null && message !== "") {
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
    input = PostToolUse.parse(JSON.parse(await Bun.stdin.text()));
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
