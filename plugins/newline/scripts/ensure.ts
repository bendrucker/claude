#!/usr/bin/env bun

import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

type ToolInput = {
  file_path?: string;
};

export async function ensureTrailingNewline(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  if (file.size === 0) {
    return "File is empty, skipping";
  }

  const content = await file.text();
  if (content.endsWith("\n")) {
    return "File already has trailing newline";
  }

  await Bun.write(filePath, `${content}\n`);
  return "Added trailing newline";
}

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  const { file_path: filePath } = input.tool_input as ToolInput;
  if (!filePath) return null;

  const message = await ensureTrailingNewline(filePath);

  if (message) {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[newline/ensure] ${message}`,
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
      `[newline/ensure] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  try {
    const output = await processInput(input);
    if (output) {
      writeStdoutJson(output);
    }
  } catch (error) {
    console.error(`[newline/ensure] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
