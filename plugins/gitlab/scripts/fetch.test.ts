import { describe, expect, it, test } from "bun:test";
import { join } from "node:path";
import type { PreToolUseHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import { formatOutput, type HookInput, isGitLabUrl, parseGitLabUrl, processInput } from "./fetch";

function mockInput(url: string): HookInput {
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

function getOutput(input: HookInput): PreToolUseHookSpecificOutput | null {
  const output = processInput(input)?.hookSpecificOutput;
  if (output?.hookEventName !== "PreToolUse") return null;
  return output;
}

describe("isGitLabUrl", () => {
  test.each<[string, boolean]>([
    ["https://gitlab.com/gitlab-org/gitlab", true],
    ["https://gitlab.com/group/subgroup/project", true],
    ["https://example.com", false],
    ["https://github.com/owner/repo", false],
    ["http://gitlab.com/owner/repo", false],
  ])("%p is %p", (url, expected) => {
    expect(isGitLabUrl(url)).toBe(expected);
  });
});

describe("parseGitLabUrl", () => {
  it("returns null for non-project GitLab URLs", () => {
    expect(parseGitLabUrl("https://gitlab.com/explore")).toBeNull();
  });

  test.each<{ name: string; url: string; type: string; suggestionContains: string }>([
    {
      name: "detects project root",
      url: "https://gitlab.com/gitlab-org/gitlab",
      type: "repo",
      suggestionContains: "glab repo view",
    },
    {
      name: "handles project root with trailing slash",
      url: "https://gitlab.com/gitlab-org/gitlab/",
      type: "repo",
      suggestionContains: "glab repo view",
    },
    {
      name: "handles nested group projects",
      url: "https://gitlab.com/group/subgroup/project",
      type: "repo",
      suggestionContains: "glab repo view",
    },
    {
      name: "detects file content (blob URL)",
      url: "https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md",
      type: "file",
      suggestionContains: "glab api",
    },
    {
      name: "detects directory (tree URL)",
      url: "https://gitlab.com/gitlab-org/gitlab/-/tree/main/src",
      type: "tree",
      suggestionContains: "glab api",
    },
    {
      name: "handles root directory tree",
      url: "https://gitlab.com/gitlab-org/gitlab/-/tree/main",
      type: "tree",
      suggestionContains: "glab api",
    },
  ])("$name", ({ url, type, suggestionContains }) => {
    const result = parseGitLabUrl(url);
    expect(result?.type).toBe(type);
    expect(result?.suggestion).toContain(suggestionContains);
  });

  test.each<{ name: string; url: string; type: string; suggestion: string }>([
    {
      name: "detects issues",
      url: "https://gitlab.com/gitlab-org/gitlab/-/issues/123",
      type: "issue",
      suggestion: "Use: glab issue view 123.",
    },
    {
      name: "detects merge requests",
      url: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456",
      type: "mr",
      suggestion: "Use: glab mr view 456.",
    },
    {
      name: "detects pipelines",
      url: "https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345",
      type: "pipeline",
      suggestion: "Use: glab ci view 12345.",
    },
    {
      name: "detects jobs",
      url: "https://gitlab.com/gitlab-org/gitlab/-/jobs/67890",
      type: "job",
      suggestion: "Use: glab ci trace 67890.",
    },
  ])("$name", ({ url, type, suggestion }) => {
    const result = parseGitLabUrl(url);
    expect(result?.type).toBe(type);
    expect(result?.suggestion).toBe(suggestion);
  });
});

describe("formatOutput", () => {
  test.each<{ name: string; decision: "deny" | "ask"; reason: string }>([
    { name: "formats deny decision", decision: "deny", reason: "Use glab instead" },
    { name: "formats ask decision", decision: "ask", reason: "Unknown pattern" },
  ])("$name", ({ decision, reason }) => {
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
  it("returns null for non-GitLab URLs", () => {
    expect(processInput(mockInput("https://example.com"))).toBeNull();
  });

  it("returns null for GitHub URLs", () => {
    expect(processInput(mockInput("https://github.com/owner/repo"))).toBeNull();
  });

  test.each<{ name: string; url: string; reason: string }>([
    {
      name: "denies project root with glab repo view suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab",
      reason: "Use: glab repo view [<project>].",
    },
    {
      name: "handles project URL with trailing slash",
      url: "https://gitlab.com/gitlab-org/gitlab/",
      reason: "Use: glab repo view [<project>].",
    },
    {
      name: "handles nested group projects",
      url: "https://gitlab.com/group/subgroup/project",
      reason: "Use: glab repo view [<project>].",
    },
    {
      name: "denies file content with glab api suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md",
      reason: "Use: glab api to fetch file contents.",
    },
    {
      name: "denies directory with glab api suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/tree/main/src",
      reason: "Use: glab api to fetch file contents.",
    },
    {
      name: "handles root directory tree",
      url: "https://gitlab.com/gitlab-org/gitlab/-/tree/main",
      reason: "Use: glab api to fetch file contents.",
    },
    {
      name: "denies issues with glab issue view suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/issues/123",
      reason: "Use: glab issue view 123.",
    },
    {
      name: "denies MRs with glab mr view suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456",
      reason: "Use: glab mr view 456.",
    },
    {
      name: "denies pipelines with glab ci view suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345",
      reason: "Use: glab ci view 12345.",
    },
    {
      name: "denies jobs with glab ci trace suggestion",
      url: "https://gitlab.com/gitlab-org/gitlab/-/jobs/67890",
      reason: "Use: glab ci trace 67890.",
    },
  ])("$name", ({ url, reason }) => {
    const output = getOutput(mockInput(url));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(reason);
  });

  it("asks for unknown GitLab URL patterns", () => {
    const output = getOutput(mockInput("https://gitlab.com/gitlab-org/gitlab/-/settings"));
    expect(output?.permissionDecision).toBe("ask");
    expect(output?.permissionDecisionReason).toContain("Unknown GitLab URL pattern");
  });
});

describe("undecodable payload", () => {
  it("logs and exits 0", async () => {
    const hook = Bun.spawn(["bun", join(import.meta.dir, "fetch.ts")], {
      stdin: new TextEncoder().encode("not json"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(hook.stdout).text(),
      new Response(hook.stderr).text(),
      hook.exited,
    ]);
    expect(stderr).toContain("[gitlab/fetch] Failed to parse hook input:");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});
