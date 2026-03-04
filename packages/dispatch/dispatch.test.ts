import { describe, expect, test } from "bun:test";
import { formatContext, inferMode } from "./context";
import type { FetchedContext } from "./sources";
import { parseUrl } from "./sources";

describe("parseUrl", () => {
  test("GitHub PR", () => {
    const source = parseUrl("https://github.com/owner/repo/pull/42");
    expect(source).toEqual({
      type: "github-pr",
      owner: "owner",
      repo: "repo",
      number: 42,
      url: "https://github.com/owner/repo/pull/42",
    });
  });

  test("GitHub issue", () => {
    const source = parseUrl("https://github.com/owner/repo/issues/7");
    expect(source).toEqual({
      type: "github-issue",
      owner: "owner",
      repo: "repo",
      number: 7,
      url: "https://github.com/owner/repo/issues/7",
    });
  });

  test("GitLab MR", () => {
    const source = parseUrl("https://gitlab.com/org/group/repo/-/merge_requests/123");
    expect(source).toEqual({
      type: "gitlab-mr",
      project: "org/group/repo",
      iid: 123,
      url: "https://gitlab.com/org/group/repo/-/merge_requests/123",
    });
  });

  test("GitLab issue", () => {
    const source = parseUrl("https://gitlab.com/org/repo/-/issues/5");
    expect(source).toEqual({
      type: "gitlab-issue",
      project: "org/repo",
      iid: 5,
      url: "https://gitlab.com/org/repo/-/issues/5",
    });
  });

  test("Linear issue", () => {
    const source = parseUrl("https://linear.app/myteam/issue/ENG-123");
    expect(source).toEqual({
      type: "linear",
      id: "ENG-123",
      url: "https://linear.app/myteam/issue/ENG-123",
    });
  });

  test("Things URL", () => {
    const source = parseUrl("things:///show?id=abc123");
    expect(source).toEqual({
      type: "things",
      id: "abc123",
    });
  });

  test("invalid URL throws", () => {
    expect(() => parseUrl("https://example.com/unknown")).toThrow("Unsupported URL");
  });

  test("Things URL without id throws", () => {
    expect(() => parseUrl("things:///show")).toThrow("Missing id parameter");
  });
});

describe("inferMode", () => {
  test("PR → review", () => {
    expect(inferMode("github-pr")).toBe("review");
    expect(inferMode("gitlab-mr")).toBe("review");
  });

  test("issue → plan", () => {
    expect(inferMode("github-issue")).toBe("plan");
    expect(inferMode("gitlab-issue")).toBe("plan");
    expect(inferMode("linear")).toBe("plan");
    expect(inferMode("things")).toBe("plan");
  });
});

describe("formatContext", () => {
  test("GitHub PR → review XML", () => {
    const context: FetchedContext = {
      type: "github-pr",
      source: {
        type: "github-pr",
        owner: "org",
        repo: "repo",
        number: 42,
        url: "https://github.com/org/repo/pull/42",
      },
      metadata: {
        title: "Fix auth",
        body: "Fixes token expiry",
        additions: 10,
        deletions: 3,
        changedFiles: 2,
        headRefName: "fix/auth",
        baseRefName: "main",
        reviews: [],
        comments: [],
        labels: [],
      },
      diff: "diff --git a/auth.ts b/auth.ts\n+fixed",
    };

    const xml = formatContext(context, "review");
    expect(xml).toContain('<pull-request source="github"');
    expect(xml).toContain('number="42"');
    expect(xml).toContain("<title>Fix auth</title>");
    expect(xml).toContain("<description>Fixes token expiry</description>");
    expect(xml).toContain('additions="10"');
    expect(xml).toContain("Review the pull request above");
  });

  test("GitHub issue → plan XML", () => {
    const context: FetchedContext = {
      type: "github-issue",
      source: {
        type: "github-issue",
        owner: "org",
        repo: "repo",
        number: 7,
        url: "https://github.com/org/repo/issues/7",
      },
      metadata: {
        title: "Add feature",
        body: "We need this feature",
        comments: [],
        labels: [{ name: "enhancement" }],
        assignees: [],
      },
    };

    const xml = formatContext(context, "plan");
    expect(xml).toContain('<task source="github"');
    expect(xml).toContain('number="7"');
    expect(xml).toContain("<title>Add feature</title>");
    expect(xml).toContain("<labels>enhancement</labels>");
    expect(xml).toContain("Review the task above and create an implementation plan");
  });

  test("prefill mode has no trailing instruction", () => {
    const context: FetchedContext = {
      type: "github-issue",
      source: {
        type: "github-issue",
        owner: "org",
        repo: "repo",
        number: 1,
        url: "https://github.com/org/repo/issues/1",
      },
      metadata: { title: "Test", body: "Body", comments: [], labels: [] },
    };

    const xml = formatContext(context, "prefill");
    expect(xml).not.toContain("Review the");
    expect(xml).toContain("<title>Test</title>");
  });

  test("XML escapes special characters", () => {
    const context: FetchedContext = {
      type: "github-issue",
      source: {
        type: "github-issue",
        owner: "org",
        repo: "repo",
        number: 1,
        url: "https://github.com/org/repo/issues/1",
      },
      metadata: {
        title: 'Fix <script> & "quotes"',
        body: "",
        comments: [],
        labels: [],
      },
    };

    const xml = formatContext(context, "prefill");
    expect(xml).toContain("Fix &lt;script&gt; &amp; &quot;quotes&quot;");
  });

  test("omits empty sections", () => {
    const context: FetchedContext = {
      type: "github-issue",
      source: {
        type: "github-issue",
        owner: "org",
        repo: "repo",
        number: 1,
        url: "https://github.com/org/repo/issues/1",
      },
      metadata: { title: "Test", body: "", comments: [], labels: [] },
    };

    const xml = formatContext(context, "prefill");
    expect(xml).not.toContain("<description>");
    expect(xml).not.toContain("<comments>");
    expect(xml).not.toContain("<labels>");
  });
});
