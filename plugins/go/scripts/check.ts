#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "fs";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import type {
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-code";

export type FileInput = {
  file_path?: string;
};

const GENERATED_MARKER = /^\/\/\s*Code\s+generated.*DO\s+NOT\s+EDIT\.$/;

export function isGeneratedFile(content: string): boolean {
  const lines = content.split("\n");
  let foundMarker = false;
  let foundCode = false;

  for (const line of lines) {
    // Skip blank lines
    if (/^\s*$/.test(line)) {
      continue;
    }

    // Check for code generated marker
    if (GENERATED_MARKER.test(line)) {
      foundMarker = true;
      continue;
    }

    // Check if this is a comment line
    if (line.startsWith("//") || line.startsWith("/*")) {
      continue;
    }

    // Found non-comment, non-blank text
    foundCode = true;
    break;
  }

  return foundMarker && foundCode;
}

export function processInput(
  input: PreToolUseHookInput
): SyncHookJSONOutput | null {
  const { file_path: filePath } = input.tool_input as FileInput;

  // Only check .go files
  if (!filePath.endsWith(".go")) {
    return null;
  }

  // File doesn't exist yet, allow operation
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, "utf-8");

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
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    console.error(
      `[go/check] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const output = processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

main().catch(console.error);
