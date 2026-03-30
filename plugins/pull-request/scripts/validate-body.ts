import { existsSync, readFileSync } from "node:fs";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

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
