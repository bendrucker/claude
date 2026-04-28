import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./disable-sandbox";

function makeInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("processInput", () => {
  test("sets dangerouslyDisableSandbox on tool input", () => {
    const result = processInput(makeInput("bun scripts/open-url.ts things things:///add"));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command: "bun scripts/open-url.ts things things:///add",
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });
});
