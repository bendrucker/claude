import { describe, expect, it, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import type { PreToolUseHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import { formatOutput, type HookInput, matchRoute, parseGitLabUrl, processInput } from "./fetch";

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

describe("parseGitLabUrl", () => {
  test.each<{ name: string; url: string }>([
    { name: "non-project pages", url: "https://gitlab.com/explore" },
    {
      name: "a reserved first segment with a resource",
      url: "https://gitlab.com/explore/projects",
    },
    { name: "a group page", url: "https://gitlab.com/groups/g/-/issues/1" },
    { name: "a user page", url: "https://gitlab.com/users/someone" },
    { name: "a REST API URL", url: "https://gitlab.com/api/v4/projects/1" },
    { name: "an instance-level route", url: "https://gitlab.com/-/snippets/1" },
    { name: "a non-numeric id", url: "https://gitlab.com/g/p/-/merge_requests/new" },
    { name: "an unrouted resource", url: "https://gitlab.com/g/p/-/settings" },
  ])("returns null for $name", ({ url }) => {
    expect(parseGitLabUrl(url)).toBeNull();
  });

  test.each<{ name: string; url: string; type: string; suggestion: string }>([
    {
      name: "project root",
      url: "https://gitlab.com/gitlab-org/gitlab",
      type: "repo",
      suggestion: "Use: glab repo view gitlab-org/gitlab.",
    },
    {
      name: "project root with a trailing slash",
      url: "https://gitlab.com/gitlab-org/gitlab/",
      type: "repo",
      suggestion: "Use: glab repo view gitlab-org/gitlab.",
    },
    {
      name: "nested group project",
      url: "https://gitlab.com/group/subgroup/project",
      type: "repo",
      suggestion: "Use: glab repo view group/subgroup/project.",
    },
    {
      name: "project root with .git",
      url: "https://gitlab.com/group/project.git",
      type: "repo",
      suggestion: "Use: glab repo view group/project.",
    },
    {
      name: "issue",
      url: "https://gitlab.com/gitlab-org/gitlab/-/issues/123",
      type: "issue",
      suggestion: "Use: glab issue view 123 -R gitlab-org/gitlab.",
    },
    {
      name: "issue in a nested group",
      url: "https://gitlab.com/g/sub/p/-/issues/9#note_1",
      type: "issue",
      suggestion: "Use: glab issue view 9 -R g/sub/p.",
    },
    {
      name: "work item",
      url: "https://gitlab.com/g/p/-/work_items/3",
      type: "issue",
      suggestion: "Use: glab issue view 3 -R g/p.",
    },
    {
      name: "merge request",
      url: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456",
      type: "mr",
      suggestion: "Use: glab mr view 456 -R gitlab-org/gitlab.",
    },
    {
      name: "merge request diffs tab",
      url: "https://gitlab.com/g/p/-/merge_requests/5/diffs",
      type: "mr",
      suggestion: "Use: glab mr diff 5 -R g/p.",
    },
    {
      name: "merge request .diff",
      url: "https://gitlab.com/g/p/-/merge_requests/5.diff",
      type: "mr",
      suggestion: "Use: glab mr diff 5 -R g/p.",
    },
    {
      name: "merge request commits",
      url: "https://gitlab.com/g/p/-/merge_requests/5/commits",
      type: "mr",
      suggestion: 'Use: glab api "projects/g%2Fp/merge_requests/5/commits".',
    },
    {
      name: "merge request pipelines tab",
      url: "https://gitlab.com/g/p/-/merge_requests/5/pipelines",
      type: "mr",
      suggestion: "Use: glab mr view 5 -R g/p.",
    },
    {
      name: "pipeline",
      url: "https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345",
      type: "pipeline",
      suggestion: "Use: glab ci get -p 12345 -R gitlab-org/gitlab -F json.",
    },
    {
      name: "pipeline builds tab",
      url: "https://gitlab.com/g/p/-/pipelines/9/builds",
      type: "pipeline",
      suggestion: "Use: glab ci get -p 9 -R g/p -F json.",
    },
    {
      name: "job",
      url: "https://gitlab.com/gitlab-org/gitlab/-/jobs/67890",
      type: "job",
      suggestion: "Use: glab ci trace 67890 -R gitlab-org/gitlab.",
    },
    {
      name: "raw job log",
      url: "https://gitlab.com/g/p/-/jobs/7/raw",
      type: "job",
      suggestion: "Use: glab ci trace 7 -R g/p.",
    },
    {
      name: "blob",
      url: "https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md",
      type: "file",
      suggestion:
        'Use: glab api "projects/gitlab-org%2Fgitlab/repository/files/README.md/raw?ref=master".',
    },
    {
      name: "raw file on a dotted ref",
      url: "https://gitlab.com/g/p/-/raw/v1.2/a/b.txt",
      type: "file",
      suggestion: 'Use: glab api "projects/g%2Fp/repository/files/a%2Fb.txt/raw?ref=v1.2".',
    },
    {
      name: "tree root",
      url: "https://gitlab.com/gitlab-org/gitlab/-/tree/main",
      type: "tree",
      suggestion: 'Use: glab api "projects/gitlab-org%2Fgitlab/repository/tree?ref=main".',
    },
    {
      name: "tree directory",
      url: "https://gitlab.com/g/p/-/tree/main/src/x",
      type: "tree",
      suggestion: 'Use: glab api "projects/g%2Fp/repository/tree?ref=main&path=src%2Fx".',
    },
    {
      name: "issue list",
      url: "https://gitlab.com/g/p/-/issues?state=opened",
      type: "issues",
      suggestion: "Use: glab issue list -R g/p.",
    },
    {
      name: "merge request list",
      url: "https://gitlab.com/g/p/-/merge_requests",
      type: "mrs",
      suggestion: "Use: glab mr list -R g/p.",
    },
    {
      name: "pipeline list",
      url: "https://gitlab.com/g/p/-/pipelines",
      type: "pipelines",
      suggestion: "Use: glab ci list -R g/p.",
    },
    {
      name: "self-managed host",
      url: "https://gitlab.example.com/g/p/-/merge_requests/5",
      type: "mr",
      suggestion: "Use: glab mr view 5 -R https://gitlab.example.com/g/p.",
    },
    {
      name: "self-managed host API call",
      url: "https://gitlab.example.com/g/p/-/raw/main/a.md",
      type: "file",
      suggestion:
        'Use: glab api --hostname gitlab.example.com "projects/g%2Fp/repository/files/a.md/raw?ref=main".',
    },
  ])("routes $name", ({ url, type, suggestion }) => {
    expect(parseGitLabUrl(url)).toEqual({ type, suggestion });
  });
});

describe("matchRoute", () => {
  it("returns the matched route with its params", () => {
    const match = matchRoute("-/merge_requests/42/diffs");
    expect(match?.route.type).toBe("mr");
    expect(match?.params.number).toBe("42");
  });

  it("rejects ids that are not digits", () => {
    expect(matchRoute("-/issues/new")).toBeNull();
    expect(matchRoute("-/pipelines/latest")).toBeNull();
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
  test.each<{ name: string; url: string; reason: string }>([
    {
      name: "denies the project root",
      url: "https://gitlab.com/gitlab-org/gitlab",
      reason: "Use: glab repo view gitlab-org/gitlab.",
    },
    {
      name: "denies an MR",
      url: "https://gitlab.com/gitlab-org/gitlab/-/merge_requests/456",
      reason: "Use: glab mr view 456 -R gitlab-org/gitlab.",
    },
    {
      name: "denies a pipeline",
      url: "https://gitlab.com/gitlab-org/gitlab/-/pipelines/12345",
      reason: "Use: glab ci get -p 12345 -R gitlab-org/gitlab -F json.",
    },
  ])("$name", ({ url, reason }) => {
    const output = getOutput(mockInput(url));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toBe(reason);
  });

  test.each<{ name: string; url: string }>([
    { name: "an unrouted resource", url: "https://gitlab.com/gitlab-org/gitlab/-/settings" },
    { name: "a reserved first segment", url: "https://gitlab.com/explore/projects" },
    { name: "the root", url: "https://gitlab.com/" },
  ])("asks for $name", ({ url }) => {
    const output = getOutput(mockInput(url));
    expect(output?.permissionDecision).toBe("ask");
    expect(output?.permissionDecisionReason).toContain("Unknown GitLab URL pattern");
  });

  test.each<{ name: string; url: string }>([
    { name: "docs.gitlab.com", url: "https://docs.gitlab.com/ci/yaml/" },
    { name: "about.gitlab.com", url: "https://about.gitlab.com/pricing" },
    { name: "github.com", url: "https://github.com/o/r/pull/1" },
    { name: "an unparseable url", url: "not a url" },
  ])("leaves $name alone", ({ url }) => {
    expect(processInput(mockInput(url))).toBeNull();
  });
});

const HooksFile = z.object({
  hooks: z.object({
    PreToolUse: z.array(
      z.object({ matcher: z.string(), hooks: z.array(z.record(z.string(), z.unknown())) }),
    ),
  }),
});

describe("hooks.json registration", () => {
  it("registers fetch.ts on every WebFetch, with no domain filter that never matches", async () => {
    const text = await Bun.file(join(import.meta.dir, "../hooks/hooks.json")).text();
    const registered = HooksFile.parse(JSON.parse(text)).hooks.PreToolUse.find(
      (entry) => entry.matcher === "WebFetch",
    )?.hooks;
    expect(registered).toHaveLength(1);
    expect(registered?.[0]?.command).toContain("scripts/fetch.ts");
    expect(registered?.[0]).not.toHaveProperty("if");
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
