#!/usr/bin/env bun

import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

export type FileInput = {
  file_path?: string;
};

const GENERATED_MARKER = /^\/\/\s*Code\s+generated.*DO\s+NOT\s+EDIT\.$/;

export function isGeneratedFile(content: string): boolean {
  const lines = content.split("\n");
  let foundMarker = false;
  let foundCode = false;

  for (const line of lines) {
    if (/^\s*$/.test(line)) {
      continue;
    }

    if (GENERATED_MARKER.test(line)) {
      foundMarker = true;
      continue;
    }

    if (line.startsWith("//") || line.startsWith("/*")) {
      continue;
    }

    // Found non-comment, non-blank text
    foundCode = true;
    break;
  }

  return foundMarker && foundCode;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const { file_path: filePath } = input.tool_input as FileInput;

  if (!filePath || !filePath.endsWith(".go")) {
    return null;
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();

  if (isGeneratedFile(content)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Cannot modify generated Go file: ${filePath}`,
      },
    };
  }

  return null;
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as PreToolUseHookInput;
  } catch (error) {
    console.error(
      `[go/check] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
