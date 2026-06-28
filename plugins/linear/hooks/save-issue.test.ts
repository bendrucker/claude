import { describe, expect, it, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { getDefaultState, normalizeInput, processInput } from "./save-issue";

function mockInput(
  toolInput: Record<string, unknown>,
  toolName = "mcp__claude_ai_Linear__save_issue",
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

describe("normalizeInput", () => {
  test.each([
    ["flat input is not mutated", { title: "x", team: "ENG" }],
    ["single issue wrapper is unwrapped", { issue: { title: "x", team: "ENG" } }],
    ["input wrapper is unwrapped", { input: { title: "x", team: "ENG" } }],
    ["parameters wrapper is unwrapped", { parameters: { title: "x", team: "ENG" } }],
    ["issueId is aliased to id", { issueId: "abc-123", title: "x" }],
    ["issueId is dropped when id is already present", { id: "real-id", issueId: "abc-123" }],
    ["unknown fields are preserved untouched", { title: "x", priority: 2, labels: ["bug"] }],
    ["a multi-key object is not treated as a wrapper", { issue: "ENG-1", title: "x" }],
  ])("%s", (_name, toolInput) => {
    expect(normalizeInput(toolInput)).toMatchSnapshot();
  });
});

describe("processInput", () => {
  test.each([
    ["create assigned to me injects Todo", { title: "Fix bug", team: "ENG", assignee: "me" }],
    ["create unassigned injects Backlog", { title: "Research perf", team: "ENG" }],
    ["create with empty assignee injects Backlog", { title: "x", team: "ENG", assignee: "" }],
    ["create preserves extra fields", { title: "x", team: "ENG", labels: ["bug"], priority: 2 }],
    ["create with no title is denied", { team: "ENG" }],
    [
      "create with explicit state passes through unchanged",
      { title: "x", team: "ENG", state: "In Progress" },
    ],
    [
      "nested issue wrapper create is unwrapped and allowed",
      { issue: { title: "x", team: "ENG" } },
    ],
    [
      "issueId-only is aliased to id and treated as an allowed update",
      { issueId: "abc-123", title: "Renamed" },
    ],
    ["update with id and no state is not modified", { id: "abc-123" }],
    ["update with explicit state is not modified", { id: "abc-123", state: "Done" }],
    ["update with issueId is normalized and allowed", { issueId: "abc-123", state: "Done" }],
  ])("%s", (_name, toolInput) => {
    expect(processInput(mockInput(toolInput))).toMatchSnapshot();
  });

  it("works with the local MCP create_issue tool name", () => {
    expect(
      processInput(mockInput({ title: "x", team: "ENG" }, "mcp__linear__create_issue")),
    ).toMatchSnapshot();
  });

  it("works with the plugin MCP create_issue tool name", () => {
    expect(
      processInput(
        mockInput({ title: "x", team: "ENG" }, "mcp__plugin_linear_linear__create_issue"),
      ),
    ).toMatchSnapshot();
  });
});
