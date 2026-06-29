#!/usr/bin/env bun

import {
  type FileInput,
  type PreToolUseHookInput,
  runHook,
} from "@bendrucker/claude-plugin-toolkit";
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
  const { file_path: filePath } = input.tool_input as FileInput;
  if (!filePath) return;
  if (isMemoryPath(filePath)) return;

  const hasNewline = await hasTrailingNewline(filePath);

  if (hasNewline === null) {
    await setState("newline", filePath, "");
  } else {
    await setState("newline", filePath, hasNewline ? "1" : "");
  }
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, void>(processInput);
}
