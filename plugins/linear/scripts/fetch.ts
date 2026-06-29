#!/usr/bin/env bun

import {
  type PreToolUseHookInput,
  preToolUse,
  runHook,
  type SyncHookJSONOutput,
  type WebFetchInput,
} from "@bendrucker/claude-plugin-toolkit";

const PUBLIC_PATH_PREFIXES = ["/docs", "/developers", "/changelog"];

export function isPublicUrl(url: string): boolean {
  const path = new URL(url).pathname;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function processInput(input: PreToolUseHookInput): SyncHookJSONOutput | null {
  const { url } = input.tool_input as WebFetchInput;

  if (isPublicUrl(url)) {
    return null;
  }

  return preToolUse.deny(
    "Linear requires authentication. Use Linear MCP instead. Run /linear for guidance.",
  );
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(processInput);
}
