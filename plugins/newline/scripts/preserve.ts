#!/usr/bin/env bun

import {
  type FileInput,
  type PostToolUseHookInput,
  postToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";
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
  const { file_path: filePath } = input.tool_input as FileInput;
  if (!filePath) return null;
  if (isMemoryPath(filePath)) return null;

  const hadNewline = await getState("newline", filePath);
  const message = await preserveNewlineState(filePath, hadNewline);

  await clearState("newline", filePath);

  if (message) {
    return postToolUse.context(`[newline/preserve] ${message}`);
  }

  return null;
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>(processInput);
}
