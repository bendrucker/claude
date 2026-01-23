import { describe, it, expect } from "vitest";
import type { PreToolUseHookInput, PreToolUseHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import { isGitHubUrl, parseGitHubUrl, formatOutput, processInput } from "./fetch";

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
  it("returns true for GitHub URLs", () => {
    expect(isGitHubUrl("https://github.com/owner/repo")).toBe(true);
    expect(isGitHubUrl("https://github.com/bendrucker/deployments")).toBe(true);
  });

  it("returns false for non-GitHub URLs", () => {
    expect(isGitHubUrl("https://example.com")).toBe(false);
    expect(isGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
    expect(isGitHubUrl("http://github.com/owner/repo")).toBe(false);
  });
});

describe("parseGitHubUrl", () => {
  it("returns null for non-repo GitHub URLs", () => {
    expect(parseGitHubUrl("https://github.com/explore")).toBeNull();
    expect(parseGitHubUrl("https://github.com/settings")).toBeNull();
  });

  it("detects repo root", () => {
    const result = parseGitHubUrl("https://github.com/bendrucker/deployments");
    expect(result?.type).toBe("repo");
    expect(result?.suggestion).toContain("gh repo view");
  });

  it("handles repo root with trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/bendrucker/deployments/");
    expect(result?.type).toBe("repo");
    expect(result?.suggestion).toContain("gh repo view");
  });

  it("detects file content (blob URL)", () => {
    const result = parseGitHubUrl(
      "https://github.com/bendrucker/bendrucker.me/blob/master/astro.config.ts",
    );
    expect(result?.type).toBe("file");
    expect(result?.suggestion).toContain("gh api");
  });

  it("detects directory (tree URL)", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/src");
    expect(result?.type).toBe("file");
    expect(result?.suggestion).toContain("gh api");
  });

  it("handles root directory tree", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main");
    expect(result?.type).toBe("file");
    expect(result?.suggestion).toContain("gh api");
  });

  it("detects issues", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/issues/123");
    expect(result?.type).toBe("issue");
    expect(result?.suggestion).toBe("Use: gh issue view 123. Run /github:gh for more patterns.");
  });

  it("detects PRs", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/pull/456");
    expect(result?.type).toBe("pr");
    expect(result?.suggestion).toBe("Use: gh pr view 456. Run /github:gh for more patterns.");
  });

  it("detects Actions run", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/actions/runs/12345");
    expect(result?.type).toBe("run");
    expect(result?.suggestion).toBe("Use: gh run view 12345. Run /github:gh for more patterns.");
  });

  it("detects Actions job", () => {
    const result = parseGitHubUrl(
      "https://github.com/terraform-linters/tflint/actions/runs/19917285716/job/57098829490",
    );
    expect(result?.type).toBe("job");
    expect(result?.suggestion).toBe(
      "Use: gh run view --job 57098829490 --log. Run /github:gh for more patterns.",
    );
  });
});

describe("formatOutput", () => {
  it("formats deny decision", () => {
    const output = formatOutput("deny", "Use gh instead");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Use gh instead",
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
  it("returns null for non-GitHub URLs", () => {
    expect(processInput(mockInput("https://example.com"))).toBeNull();
  });

  it("denies repo root with gh repo view suggestion", () => {
    const output = getOutput(mockInput("https://github.com/bendrucker/deployments"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh repo view [<repository>]. Run /github:gh for more patterns.",
    );
  });

  it("handles repository URL with trailing slash", () => {
    const output = getOutput(mockInput("https://github.com/bendrucker/deployments/"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh repo view [<repository>]. Run /github:gh for more patterns.",
    );
  });

  it("denies file content with gh api suggestion", () => {
    const output = getOutput(
      mockInput("https://github.com/bendrucker/bendrucker.me/blob/master/astro.config.ts"),
    );
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh api to fetch file contents. Run /github:gh for more patterns.",
    );
  });

  it("denies directory with gh api suggestion", () => {
    const output = getOutput(mockInput("https://github.com/owner/repo/tree/main/src"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh api to fetch file contents. Run /github:gh for more patterns.",
    );
  });

  it("handles root directory tree", () => {
    const output = getOutput(mockInput("https://github.com/owner/repo/tree/main"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh api to fetch file contents. Run /github:gh for more patterns.",
    );
  });

  it("denies issues with gh issue view suggestion", () => {
    const output = getOutput(mockInput("https://github.com/owner/repo/issues/123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh issue view 123. Run /github:gh for more patterns.",
    );
  });

  it("denies PRs with gh pr view suggestion", () => {
    const output = getOutput(mockInput("https://github.com/owner/repo/pull/456"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh pr view 456. Run /github:gh for more patterns.",
    );
  });

  it("denies Actions run with gh run view suggestion", () => {
    const output = getOutput(mockInput("https://github.com/owner/repo/actions/runs/12345"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh run view 12345. Run /github:gh for more patterns.",
    );
  });

  it("denies Actions job with gh run view --job suggestion", () => {
    const output = getOutput(
      mockInput(
        "https://github.com/terraform-linters/tflint/actions/runs/19917285716/job/57098829490",
      ),
    );
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(
      "Use: gh run view --job 57098829490 --log. Run /github:gh for more patterns.",
    );
  });

  it("asks for unknown GitHub URL patterns", () => {
    const output = getOutput(mockInput("https://github.com/explore"));
    expect(output?.permissionDecision).toBe("ask");
    expect(output?.permissionDecisionReason).toContain("Run /github:gh for guidance");
  });
});
