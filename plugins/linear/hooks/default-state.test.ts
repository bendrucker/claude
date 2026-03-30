import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { getDefaultState, processInput } from "./default-state";

function mockInput(
  toolInput: Record<string, unknown>,
  toolName = "mcp__linear__create_issue",
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test",
  };
}

describe("getDefaultState", () => {
  it("returns Backlog when no assignee", () => {
    expect(getDefaultState(undefined)).toBe("Backlog");
  });

  it("returns Todo when assignee is set", () => {
    expect(getDefaultState("me")).toBe("Todo");
  });

  it("returns Backlog when assignee is empty string", () => {
    expect(getDefaultState("")).toBe("Backlog");
  });
});

describe("processInput", () => {
  it("defaults to Backlog when no assignee", () => {
    const output = processInput(mockInput({ title: "Test issue", team: "ENG" }));
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          state: "Backlog",
        },
      },
    });
  });

  it("defaults to Todo when assignee is set", () => {
    const output = processInput(mockInput({ title: "Test issue", team: "ENG", assignee: "me" }));
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          state: "Todo",
        },
      },
    });
  });

  it("defaults to Backlog when assignee is empty string", () => {
    const output = processInput(mockInput({ title: "Test issue", team: "ENG", assignee: "" }));
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          state: "Backlog",
        },
      },
    });
  });

  it("does not modify the input when state is already set", () => {
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG", state: "In Progress" }),
    );
    expect(output).toBeNull();
  });

  it("does not modify even with assignee set when state is present", () => {
    const output = processInput(
      mockInput({
        title: "Test issue",
        team: "ENG",
        state: "Done",
        assignee: "me",
      }),
    );
    expect(output).toBeNull();
  });

  it("works with Claude AI MCP tool name pattern", () => {
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG" }, "mcp__claude_ai_Linear__save_issue"),
    );
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          state: "Backlog",
        },
      },
    });
  });

  it("works with plugin MCP tool name pattern", () => {
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG" }, "mcp__plugin_linear_linear__create_issue"),
    );
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: {
          state: "Backlog",
        },
      },
    });
  });
});
