#!/usr/bin/env bun

import {
  type FileInput,
  type PreToolUseHookInput,
  preToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";

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
    return preToolUse.deny(`Cannot modify generated Go file: ${filePath}`);
  }

  return null;
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(processInput);
}
