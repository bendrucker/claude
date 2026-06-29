#!/usr/bin/env bun

import { extname } from "node:path";
import {
  type PostToolUseHookInput,
  postToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";

import { validate } from "./validate";

export function isSvgFile(filePath: string): boolean {
  return extname(filePath) === ".svg";
}

export async function processInput(
  input: PostToolUseHookInput,
): Promise<SyncHookJSONOutput | null> {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
    return null;
  }

  const filePath = (input.tool_input as { file_path?: string }).file_path;
  if (!filePath || !isSvgFile(filePath)) {
    return null;
  }

  const content = await Bun.file(filePath).text();
  const violations = validate(content);

  if (violations.length === 0) {
    return null;
  }

  const details = violations.map((v) => `- ${v.element}: ${v.issue}\n  ${v.details}`).join("\n");

  return postToolUse.additionalContext(`Wireframe validation found ${violations.length} issue(s) in ${filePath}:

${details}

Fix these layout issues before rendering.`);
}

if (import.meta.main) {
  runHook<PostToolUseHookInput, SyncHookJSONOutput>(processInput);
}
