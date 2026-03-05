import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./index";

function bashInput(command: string): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: { command },
  } as PreToolUseHookInput;
}

describe("processInput", () => {
  it("replaces \\! with ! in jq expressions", () => {
    const result = processInput(bashInput("jq 'select(.x \\!= null)' file.json"));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "jq 'select(.x != null)' file.json" },
      },
    });
  });

  it("replaces \\! with ! in awk expressions", () => {
    const result = processInput(bashInput("awk '$1 \\!~ /pattern/' file.txt"));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "awk '$1 !~ /pattern/' file.txt" },
      },
    });
  });

  it("replaces multiple occurrences", () => {
    const result = processInput(bashInput("jq 'select(.a \\!= null and .b \\!= null)'"));
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "jq 'select(.a != null and .b != null)'" },
      },
    });
  });

  it("returns null when command has no escaped bangs", () => {
    expect(processInput(bashInput("ls -la"))).toBeNull();
    expect(processInput(bashInput("echo hello"))).toBeNull();
  });

  it("returns null when command contains unescaped bangs", () => {
    expect(processInput(bashInput("echo 'hello!'"))).toBeNull();
  });

  it("returns null when command is missing", () => {
    const input = { tool_name: "Bash", tool_input: {} } as PreToolUseHookInput;
    expect(processInput(input)).toBeNull();
  });

  it("preserves other tool_input fields", () => {
    const input = {
      tool_name: "Bash",
      tool_input: { command: "echo \\!done", timeout: 5000 },
    } as PreToolUseHookInput;
    const result = processInput(input);
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command: "echo !done", timeout: 5000 },
      },
    });
  });
});
