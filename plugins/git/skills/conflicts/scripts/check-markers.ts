#!/usr/bin/env bun

import {
  type PreToolUseHookInput,
  preToolUse,
  runHook,
  type SyncHookJSONOutput,
} from "@bendrucker/claude-plugin-toolkit";
import { $ } from "bun";

async function checkMarkers(): Promise<SyncHookJSONOutput | null> {
  const result = await $`git diff --cached --check`.quiet().nothrow();

  if (result.exitCode === 0) {
    return null;
  }

  const output = result.stderr.toString() || result.stdout.toString();
  const markers = output
    .split("\n")
    .filter((line) => line.includes("conflict marker"))
    .slice(0, 5)
    .join(", ");

  return preToolUse.deny(
    `Conflict markers in staged files: ${markers || "run 'git diff --cached --check' for details"}`,
  );
}

if (import.meta.main) {
  runHook<PreToolUseHookInput, SyncHookJSONOutput>(checkMarkers);
}
