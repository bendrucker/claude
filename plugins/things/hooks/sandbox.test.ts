import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./sandbox";

const scriptsPath = "/home/user/.claude/plugins/things/scripts";

function makeInput(command?: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: command ? { command } : {},
  } as PreToolUseHookInput;
}

describe("processInput", () => {
  test("simple command with scripts path returns dangerouslyDisableSandbox", () => {
    const result = processInput(
      makeInput(`bun ${scriptsPath}/run-jxa.ts Things3 find-todos.js`),
      scriptsPath,
    );
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command: `bun ${scriptsPath}/run-jxa.ts Things3 find-todos.js`,
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });

  test("piped command with scripts path returns dangerouslyDisableSandbox", () => {
    const command = `bun ${scriptsPath}/run-jxa.ts Things3 find-todos.js | bun ${scriptsPath}/format-output.ts --columns name,tags`;
    const result = processInput(makeInput(command), scriptsPath);
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          command,
          dangerouslyDisableSandbox: true,
        },
      },
    });
  });

  test("unrelated command returns null", () => {
    const result = processInput(makeInput("git status"), scriptsPath);
    expect(result).toBeNull();
  });

  test("missing command field returns null", () => {
    const result = processInput(makeInput(), scriptsPath);
    expect(result).toBeNull();
  });
});
