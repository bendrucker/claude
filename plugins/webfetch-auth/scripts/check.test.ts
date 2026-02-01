import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatOutput, processInput } from "./check";

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

describe("formatOutput", () => {
  it("formats deny decision", () => {
    const output = formatOutput("deny", "Use MCP instead");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Use MCP instead",
      },
    });
  });

  it("formats ask decision", () => {
    const output = formatOutput("ask", "Unknown pattern");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Unknown pattern",
      },
    });
  });
});

describe("processInput", () => {
  it("returns null for non-authenticated URLs", () => {
    expect(processInput(mockInput("https://example.com"))).toBeNull();
    expect(processInput(mockInput("https://github.com/owner/repo"))).toBeNull();
    expect(processInput(mockInput("https://docs.anthropic.com/en/api"))).toBeNull();
  });

  it("denies Google Docs URLs", () => {
    const output = getOutput(mockInput("https://docs.google.com/document/d/abc123/edit"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Google Docs requires authentication. Use Google Drive MCP or export as PDF.",
    );
  });

  it("denies Google Sheets URLs", () => {
    const output = getOutput(mockInput("https://docs.google.com/spreadsheets/d/abc123/edit"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Google Docs");
  });

  it("denies Atlassian Confluence URLs", () => {
    const output = getOutput(
      mockInput("https://mycompany.atlassian.net/wiki/spaces/ABC/pages/123"),
    );
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Atlassian sites require authentication. Use Confluence or Jira MCP.",
    );
  });

  it("denies Atlassian Jira URLs", () => {
    const output = getOutput(mockInput("https://mycompany.atlassian.net/browse/PROJ-123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Atlassian");
  });

  it("denies Notion URLs", () => {
    const output = getOutput(mockInput("https://www.notion.so/myworkspace/Page-abc123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Notion requires authentication. Use Notion MCP.",
    );
  });

  it("denies Notion workspace URLs", () => {
    const output = getOutput(mockInput("https://myworkspace.notion.so/doc/abc123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Notion");
  });

  it("denies Linear URLs", () => {
    const output = getOutput(mockInput("https://linear.app/myteam/issue/ABC-123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Linear requires authentication. Use Linear MCP or load `linear:linear` skill.",
    );
  });

  it("denies Linear project URLs", () => {
    const output = getOutput(mockInput("https://linear.app/myteam/project/abc123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Linear");
  });

  it("handles missing tool_input", () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "WebFetch",
      tool_input: undefined as unknown as Record<string, unknown>,
      tool_use_id: "test",
    };
    const output = getOutput(input);
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("invalid input");
  });

  it("handles missing url in tool_input", () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "WebFetch",
      tool_input: { prompt: "test" },
      tool_use_id: "test",
    };
    const output = getOutput(input);
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("invalid URL");
  });
});
