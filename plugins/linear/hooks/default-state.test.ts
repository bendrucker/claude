import { describe, it, expect } from "vitest";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-code";
import { getDefaultState, processInput } from "./default-state.ts";

function mockInput(
  toolInput: Record<string, unknown>
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "mcp__linear__create_issue",
    tool_input: toolInput,
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
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG" })
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

  it("defaults to Todo when assignee is set", () => {
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG", assignee: "me" })
    );
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
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG", assignee: "" })
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

  it("does not modify the input when state is already set", () => {
    const output = processInput(
      mockInput({ title: "Test issue", team: "ENG", state: "In Progress" })
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
      })
    );
    expect(output).toBeNull();
  });
});
