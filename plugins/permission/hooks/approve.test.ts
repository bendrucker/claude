import { describe, expect, it } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./approve";

function mockInput(toolName: string, toolInput: Record<string, unknown> = {}): PreToolUseHookInput {
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

function isApproved(input: PreToolUseHookInput): boolean {
  const result = processInput(input);
  return result?.hookSpecificOutput?.permissionDecision === "allow";
}

describe("read-only tools", () => {
  it.each(["Read", "Glob", "Grep", "WebSearch", "LS"])("approves %s", (tool) => {
    expect(isApproved(mockInput(tool))).toBe(true);
  });
});

describe("safe Bash commands", () => {
  it("approves bun test with arguments", () => {
    expect(isApproved(mockInput("Bash", { command: "bun test plugins/permission" }))).toBe(true);
  });

  it("approves npm test", () => {
    expect(isApproved(mockInput("Bash", { command: "npm test" }))).toBe(true);
  });

  it("approves go test ./...", () => {
    expect(isApproved(mockInput("Bash", { command: "go test ./..." }))).toBe(true);
  });

  it("approves commands with leading whitespace", () => {
    expect(isApproved(mockInput("Bash", { command: "  bun test" }))).toBe(true);
  });
});

describe("rejected tools", () => {
  it("returns null for Edit", () => {
    expect(processInput(mockInput("Edit"))).toBeNull();
  });

  it("returns null for Write", () => {
    expect(processInput(mockInput("Write"))).toBeNull();
  });
});

describe("rejected Bash commands", () => {
  it("returns null for arbitrary commands", () => {
    expect(processInput(mockInput("Bash", { command: "rm -rf /" }))).toBeNull();
  });

  it("returns null for commands containing but not starting with test patterns", () => {
    expect(processInput(mockInput("Bash", { command: "echo bun test" }))).toBeNull();
  });

  it("returns null for missing command", () => {
    expect(processInput(mockInput("Bash", {}))).toBeNull();
  });
});
