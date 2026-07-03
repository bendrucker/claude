import { describe, expect, test } from "bun:test";
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
  test.each<[string, boolean]>([
    ["https://linear.app/docs", true],
    ["https://linear.app/docs/due-dates", true],
    ["https://linear.app/docs/due-dates.md", true],
    ["https://linear.app/developers", true],
    ["https://linear.app/developers/api", true],
    ["https://linear.app/changelog", true],
    ["https://linear.app/changelog/2024", true],
    ["https://linear.app/myteam/issue/ABC-123", false],
    ["https://linear.app/myteam/project/abc", false],
  ])("%s is public: %p", (url, expected) => {
    expect(isPublicUrl(url)).toBe(expected);
  });
});

describe("processInput", () => {
  test.each<[string, string, string | null]>([
    ["allows public docs URL", "https://linear.app/docs/due-dates", null],
    ["allows public developers URL", "https://linear.app/developers", null],
    ["allows public changelog URL", "https://linear.app/changelog", null],
    ["denies workspace issue URLs", "https://linear.app/myteam/issue/ABC-123", "Linear MCP"],
    ["denies workspace project URLs", "https://linear.app/myteam/project/abc123", "Linear MCP"],
  ])("%s", (_name, url, expectedReason) => {
    const output = getOutput(mockInput(url));
    if (expectedReason === null) {
      expect(output).toBeNull();
      return;
    }
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain(expectedReason);
  });
});
