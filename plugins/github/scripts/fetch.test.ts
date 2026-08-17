import { describe, expect, it, test } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatOutput, isGitHubUrl, parseGitHubUrl, processInput } from "./fetch";

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

describe("isGitHubUrl", () => {
  test.each<[string, boolean]>([
    ["https://github.com/owner/repo", true],
    ["https://github.com/bendrucker/deployments", true],
    ["https://example.com", false],
    ["https://gitlab.com/owner/repo", false],
    ["http://github.com/owner/repo", false],
  ])("isGitHubUrl(%p) -> %p", (url, expected) => {
    expect(isGitHubUrl(url)).toBe(expected);
  });
});

describe("parseGitHubUrl", () => {
  test.each(["https://github.com/explore", "https://github.com/settings"])(
    "returns null for %p",
    (url) => {
      expect(parseGitHubUrl(url)).toBeNull();
    },
  );

  test.each<[string, string, string]>([
    ["https://github.com/bendrucker/deployments", "repo", "gh repo view"],
    ["https://github.com/bendrucker/deployments/", "repo", "gh repo view"],
    ["https://github.com/bendrucker/bendrucker.me/blob/master/astro.config.ts", "file", "gh api"],
    ["https://github.com/owner/repo/tree/main/src", "file", "gh api"],
    ["https://github.com/owner/repo/tree/main", "file", "gh api"],
  ])("detects %p -> type %p", (url, type, suggestionContains) => {
    const result = parseGitHubUrl(url);
    expect(result?.type).toBe(type);
    expect(result?.suggestion).toContain(suggestionContains);
  });

  test.each<[string, string, string]>([
    ["https://github.com/owner/repo/issues/123", "issue", "Use: gh issue view 123."],
    ["https://github.com/owner/repo/pull/456", "pr", "Use: gh pr view 456."],
    ["https://github.com/owner/repo/actions/runs/12345", "run", "Use: gh run view 12345."],
    [
      "https://github.com/terraform-linters/tflint/actions/runs/19917285716/job/57098829490",
      "job",
      "Use: gh run view --job 57098829490 --log.",
    ],
  ])("detects %p -> type %p", (url, type, suggestion) => {
    const result = parseGitHubUrl(url);
    expect(result?.type).toBe(type);
    expect(result?.suggestion).toBe(suggestion);
  });
});

describe("formatOutput", () => {
  test.each<["deny" | "ask", string]>([
    ["deny", "Use gh instead"],
    ["ask", "Unknown pattern"],
  ])("formats %p decision", (decision, reason) => {
    const output = formatOutput(decision, reason);
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    });
  });
});

describe("processInput", () => {
  it("returns null for non-GitHub URLs", () => {
    expect(processInput(mockInput("https://example.com"))).toBeNull();
  });

  it("passes through unknown GitHub URL patterns", () => {
    const output = getOutput(mockInput("https://github.com/explore"));
    expect(output).toBeNull();
  });

  test.each<[string, string]>([
    ["https://github.com/bendrucker/deployments", "Use: gh repo view [<repository>]."],
    ["https://github.com/bendrucker/deployments/", "Use: gh repo view [<repository>]."],
    [
      "https://github.com/bendrucker/bendrucker.me/blob/master/astro.config.ts",
      "Use: gh api to fetch file contents.",
    ],
    ["https://github.com/owner/repo/tree/main/src", "Use: gh api to fetch file contents."],
    ["https://github.com/owner/repo/tree/main", "Use: gh api to fetch file contents."],
    ["https://github.com/owner/repo/issues/123", "Use: gh issue view 123."],
    ["https://github.com/owner/repo/pull/456", "Use: gh pr view 456."],
    ["https://github.com/owner/repo/actions/runs/12345", "Use: gh run view 12345."],
    [
      "https://github.com/terraform-linters/tflint/actions/runs/19917285716/job/57098829490",
      "Use: gh run view --job 57098829490 --log.",
    ],
  ])("denies %p", (url, reason) => {
    const output = getOutput(mockInput(url));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(reason);
  });
});
