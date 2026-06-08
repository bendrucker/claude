import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatOutput, isGitLabUrl, parseGitLabUrl, processInput } from "./fetch";

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

describe("isGitLabUrl", () => {
  it("returns true for GitLab URLs", () => {
    expect(isGitLabUrl("https://gitlab.com/gitlab-org/gitlab")).toBe(true);
    expect(isGitLabUrl("https://gitlab.com/group/subgroup/project")).toBe(true);
  });

  it("returns false for non-GitLab URLs", () => {
    expect(isGitLabUrl("https://example.com")).toBe(false);
    expect(isGitLabUrl("https://github.com/owner/repo")).toBe(false);
    expect(isGitLabUrl("http://gitlab.com/owner/repo")).toBe(false);
  });
});

describe("parseGitLabUrl", () => {
  it("returns null for non-project GitLab URLs", () => {
    expect(parseGitLabUrl("https://gitlab.com/explore")).toBeNull();
  });

  it("detects project root", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab");
    expect(result?.type).toBe("repo");
    expect(result?.suggestion).toContain("glab repo view");
  });

  it("handles project root with trailing slash", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/");
    expect(result?.type).toBe("repo");
    expect(result?.suggestion).toContain("glab repo view");
  });

  it("handles nested group projects", () => {
    const result = parseGitLabUrl("https://gitlab.com/group/subgroup/project");
    expect(result?.type).toBe("repo");
    expect(result?.suggestion).toContain("glab repo view");
  });

  it("detects file content (blob URL)", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md");
    expect(result?.type).toBe("file");
    expect(result?.suggestion).toContain("glab api");
  });

  it("detects directory (tree URL)", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/tree/main/src");
    expect(result?.type).toBe("tree");
    expect(result?.suggestion).toContain("glab api");
  });

  it("handles root directory tree", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/tree/main");
    expect(result?.type).toBe("tree");
    expect(result?.suggestion).toContain("glab api");
  });

  it("detects issues", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/issues/123");
    expect(result?.type).toBe("issue");
    expect(result?.suggestion).toBe("Use: glab issue view 123.");
  });

  it("detects merge requests", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456");
    expect(result?.type).toBe("mr");
    expect(result?.suggestion).toBe("Use: glab mr view 456.");
  });

  it("detects pipelines", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345");
    expect(result?.type).toBe("pipeline");
    expect(result?.suggestion).toBe("Use: glab ci view 12345.");
  });

  it("detects jobs", () => {
    const result = parseGitLabUrl("https://gitlab.com/gitlab-org/gitlab/-/jobs/67890");
    expect(result?.type).toBe("job");
    expect(result?.suggestion).toBe("Use: glab ci trace 67890.");
  });
});

describe("formatOutput", () => {
  it("formats deny decision", () => {
    const output = formatOutput("deny", "Use glab instead");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Use glab instead",
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
  it("returns null for non-GitLab URLs", () => {
    expect(processInput(mockInput("https://example.com"))).toBeNull();
  });

  it("returns null for GitHub URLs", () => {
    expect(processInput(mockInput("https://github.com/owner/repo"))).toBeNull();
  });

  it("denies project root with glab repo view suggestion", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab repo view [<project>].");
  });

  it("handles project URL with trailing slash", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab repo view [<project>].");
  });

  it("handles nested group projects", () => {
    const output = getOutput(mockInput("https://gitlab.com/group/subgroup/project"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab repo view [<project>].");
  });

  it("denies file content with glab api suggestion", () => {
    const output = getOutput(
      mockInput("https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md"),
    );
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab api to fetch file contents.");
  });

  it("denies directory with glab api suggestion", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/tree/main/src"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab api to fetch file contents.");
  });

  it("handles root directory tree", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/tree/main"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab api to fetch file contents.");
  });

  it("denies issues with glab issue view suggestion", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/issues/123"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab issue view 123.");
  });

  it("denies MRs with glab mr view suggestion", () => {
    const output = getOutput(
      mockInput("https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456"),
    );
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab mr view 456.");
  });

  it("denies pipelines with glab ci view suggestion", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab ci view 12345.");
  });

  it("denies jobs with glab ci trace suggestion", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/jobs/67890"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe("Use: glab ci trace 67890.");
  });

  it("asks for unknown GitLab URL patterns", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/settings"));
    expect(output?.permissionDecision).toBe("ask");
    expect(output?.permissionDecisionReason).toContain("Unknown GitLab URL pattern");
  });
});
