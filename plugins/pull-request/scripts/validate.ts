#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

function hasBashCommand(input: unknown): input is { command: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof (input as { command: unknown }).command === "string"
  );
}

const TEST_COUNT_PATTERN =
  /[Aa]dded [0-9]+ (unit |integration )?tests|[0-9]+ (unit |integration )?tests/;

export function extractBodyFilePath(command: string): string | null {
  const match = command.match(/--body-file[=\s]([^\s]+)/);
  return match?.[1] ?? null;
}

export function validateBody(body: string): SyncHookJSONOutput | null {
  if (TEST_COUNT_PATTERN.test(body)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Testing section should not mention test counts. Describe what is covered instead.",
      },
    };
  }

  return null;
}

export async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  if (!hasBashCommand(input.tool_input)) {
    return null;
  }
  const { command } = input.tool_input;

  const bodyFilePath = extractBodyFilePath(command);
  if (!bodyFilePath) {
    return null;
  }

  if (!existsSync(bodyFilePath)) {
    return null;
  }

  const body = readFileSync(bodyFilePath, "utf-8");
  return validateBody(body);
}

function denyWithError(reason: string): void {
  writeStdoutJson({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

async function main(): Promise<void> {
  let input: PreToolUseHookInput;
  try {
    input = await readStdinJson<PreToolUseHookInput>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Failed to parse hook input: ${message}`);
    denyWithError(`Validation hook failed to parse input: ${message}`);
    return;
  }

  const output = await processInput(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pull-request/validate] Unexpected error: ${message}`);
    denyWithError(`Validation hook encountered an error: ${message}`);
  });
}
