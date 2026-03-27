import { describe, expect, it } from "bun:test";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput } from "./index";

function mockInput(toolResponse: string): PostToolUseHookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "WebFetch",
    tool_input: { url: "https://example.com/page", prompt: "test" },
    tool_response: toolResponse,
    tool_use_id: "test",
  };
}

function getContext(input: PostToolUseHookInput): string | undefined {
  const result = processInput(input);
  if (!result) return undefined;
  return (result.hookSpecificOutput as PostToolUseHookSpecificOutput).additionalContext;
}

describe("processInput", () => {
  it("returns null for successful responses", () => {
    expect(processInput(mockInput("Page content here"))).toBeNull();
  });

  it("returns null for non-404 errors", () => {
    expect(processInput(mockInput("Request failed with status code 500"))).toBeNull();
  });

  it("returns additional context for 404 responses", () => {
    const context = getContext(mockInput("Request failed with status code 404"));
    expect(context).toContain("WebFetch returned 404");
    expect(context).toContain("WebSearch");
  });

  it("detects 404 within longer error messages", () => {
    const context = getContext(
      mockInput("Error: Request failed with status code 404 for https://example.com/missing"),
    );
    expect(context).toContain("WebFetch returned 404");
  });
});
