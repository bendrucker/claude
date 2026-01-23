#!/usr/bin/env npx tsx

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

type ToolInput = {
  file_path?: string;
};

export function ensureTrailingNewline(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const stat = statSync(filePath);
  if (stat.size === 0) {
    return "File is empty, skipping";
  }

  const content = readFileSync(filePath, "utf-8");
  if (content.endsWith("\n")) {
    return "File already has trailing newline";
  }

  writeFileSync(filePath, `${content}\n`);
  return "Added trailing newline";
}

export function processInput(input: PostToolUseHookInput): SyncHookJSONOutput | null {
  const { file_path: filePath } = input.tool_input as ToolInput;
  if (!filePath) return null;

  const message = ensureTrailingNewline(filePath);

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
    const output = processInput(input);
    if (output) {
      writeStdoutJson(output);
    }
  } catch (error) {
    console.error(`[newline/ensure] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch(console.error);
