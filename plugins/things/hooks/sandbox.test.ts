import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./sandbox";

function makeInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("processInput", () => {
  test("sets dangerouslyDisableSandbox on tool input", () => {
    const result = processInput(makeInput("bun scripts/run-jxa.ts Things3"));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command: "bun scripts/run-jxa.ts Things3",
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });
});
