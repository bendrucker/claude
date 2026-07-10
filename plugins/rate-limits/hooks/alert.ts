#!/usr/bin/env bun

import type { SyncHookJSONOutput, UserPromptSubmitHookInput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import { readHistory, readRateLimits } from "../scripts/history";
import { markerChanged, markerPath, readMarker, writeMarker } from "../scripts/marker";
import { evaluate } from "../scripts/predict";

export async function processInput(
  input: UserPromptSubmitHookInput,
  nowMs: number,
): Promise<SyncHookJSONOutput | null> {
  const sessionId = input.session_id;
  if (!sessionId) return null;

  const rl = await readRateLimits();
  if (!rl) return null;

  const history = await readHistory();
  const path = markerPath(sessionId);
  const prev = await readMarker(path);
  const result = evaluate(history, rl, nowMs, prev);
  if (!result) return null;

  // Within the same block and unchanged prediction state the marker is
  // identical, so skip the write to keep the hook near-zero cost on the common
  // per-prompt path.
  if (markerChanged(prev, result.marker)) {
    try {
      await writeMarker(path, result.marker);
    } catch {
      return null;
    }
  }

  if (result.messages.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: result.messages.join("\n\n"),
    },
  };
}

async function main(): Promise<void> {
  let input: UserPromptSubmitHookInput;
  try {
    input = await readStdinJson<UserPromptSubmitHookInput>();
  } catch (error) {
    console.error(
      `[rate-limits] Failed to parse hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input, Date.now());
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
