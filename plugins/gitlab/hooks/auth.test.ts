import { describe, expect, it } from "bun:test";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./auth";

function mockInput(command: string, toolResponse: unknown = {}): PostToolUseHookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: toolResponse,
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

describe("glab auth hook", () => {
  it("returns recovery guidance for invalid_grant error", () => {
    const input = mockInput("glab mr view 112", {
      stdout: "",
      stderr: 'oauth2: "invalid_grant" "The provided authorization grant is invalid"',
    });
    const result = processInput(input);
    expect(result).not.toBeNull();
    expect(
      (result?.hookSpecificOutput as { additionalContext: string }).additionalContext,
    ).toContain("glab auth login");
  });

  it("ignores glab commands without auth errors", () => {
    const input = mockInput("glab mr list", { stdout: "No merge requests" });
    expect(processInput(input)).toBeNull();
  });

  it("ignores non-glab commands", () => {
    const input = mockInput("git status", {
      stderr: 'oauth2: "invalid_grant"',
    });
    expect(processInput(input)).toBeNull();
  });

  it("ignores commands with no response", () => {
    const input = mockInput("glab mr view 1");
    expect(processInput(input)).toBeNull();
  });
});
