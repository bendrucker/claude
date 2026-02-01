import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { isPublicUrl, processInput } from "./fetch";

function mockInput(url: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "WebFetch",
    tool_input: { url, prompt: "test" },
    tool_use_id: "test",
  };
}

function getOutput(input: PreToolUseHookInput): PreToolUseHookSpecificOutput | null {
  const result = processInput(input);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("isPublicUrl", () => {
  it("allows docs URLs", () => {
    expect(isPublicUrl("https://linear.app/docs")).toBe(true);
    expect(isPublicUrl("https://linear.app/docs/due-dates")).toBe(true);
    expect(isPublicUrl("https://linear.app/docs/due-dates.md")).toBe(true);
  });

  it("allows developers URLs", () => {
    expect(isPublicUrl("https://linear.app/developers")).toBe(true);
    expect(isPublicUrl("https://linear.app/developers/api")).toBe(true);
  });

  it("allows changelog URLs", () => {
    expect(isPublicUrl("https://linear.app/changelog")).toBe(true);
    expect(isPublicUrl("https://linear.app/changelog/2024")).toBe(true);
  });

  it("blocks workspace URLs", () => {
    expect(isPublicUrl("https://linear.app/myteam/issue/ABC-123")).toBe(false);
    expect(isPublicUrl("https://linear.app/myteam/project/abc")).toBe(false);
  });
});

describe("processInput", () => {
  it("allows public docs URLs", () => {
    expect(processInput(mockInput("https://linear.app/docs/due-dates"))).toBeNull();
    expect(processInput(mockInput("https://linear.app/developers"))).toBeNull();
    expect(processInput(mockInput("https://linear.app/changelog"))).toBeNull();
  });

  it("denies workspace issue URLs", () => {
    const output = getOutput(mockInput("https://linear.app/myteam/issue/ABC-123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Linear MCP");
  });

  it("denies workspace project URLs", () => {
    const output = getOutput(mockInput("https://linear.app/myteam/project/abc123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Linear MCP");
  });
});
