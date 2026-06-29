#!/usr/bin/env bun

import {
  type FileInput,
  type PostToolUseHookInput,
  postToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";
import { isMemoryPath } from "./memory-path";

export async function ensureTrailingNewline(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  if (file.size === 0) {
    return null;
  }

  const content = await file.text();
  if (content.endsWith("\n")) {
    return null;
  }

  await Bun.write(filePath, `${content}\n`);
  return "Added trailing newline";
}

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  const { file_path: filePath } = input.tool_input as FileInput;
  if (!filePath) return null;
  if (isMemoryPath(filePath)) return null;

  const message = await ensureTrailingNewline(filePath);

  if (message) {
    return postToolUse.context(`[newline/ensure] ${message}`);
  }

  return null;
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>(processInput);
}
