import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { parseIssueUrl, readTarget, writeTarget } from "./target";

describe("parseIssueUrl", () => {
  describe("GitHub", () => {
    it("parses a GitHub issue URL", () => {
      expect(parseIssueUrl("https://github.com/owner/repo/issues/42")).toEqual({
        service: "github",
        owner: "owner",
        repo: "repo",
        number: 42,
      });
    });

    it("handles trailing slash", () => {
      expect(parseIssueUrl("https://github.com/owner/repo/issues/42/")).toEqual({
        service: "github",
        owner: "owner",
        repo: "repo",
        number: 42,
      });
    });

    it("returns null for a PR URL", () => {
      expect(parseIssueUrl("https://github.com/owner/repo/pull/42")).toBeNull();
    });

    it("returns null for a repo URL without issue path", () => {
      expect(parseIssueUrl("https://github.com/owner/repo")).toBeNull();
    });

    it("returns null for issue list URL", () => {
      expect(parseIssueUrl("https://github.com/owner/repo/issues")).toBeNull();
    });
  });

  describe("Linear", () => {
    it("parses a Linear issue URL", () => {
      expect(parseIssueUrl("https://linear.app/acme/issue/ENG-123")).toEqual({
        service: "linear",
        identifier: "ENG-123",
      });
    });

    it("parses a Linear issue URL with title slug", () => {
      expect(parseIssueUrl("https://linear.app/acme/issue/ENG-456/some-title-slug")).toEqual({
        service: "linear",
        identifier: "ENG-456",
      });
    });
  });

  describe("GitLab", () => {
    it("parses a GitLab issue URL", () => {
      expect(parseIssueUrl("https://gitlab.com/group/project/-/issues/10")).toEqual({
        service: "gitlab",
        project: "group/project",
        number: 10,
      });
    });

    it("parses a GitLab issue URL with nested groups", () => {
      expect(parseIssueUrl("https://gitlab.com/org/team/project/-/issues/5")).toEqual({
        service: "gitlab",
        project: "org/team/project",
        number: 5,
      });
    });

    it("handles trailing slash", () => {
      expect(parseIssueUrl("https://gitlab.com/group/project/-/issues/10/")).toEqual({
        service: "gitlab",
        project: "group/project",
        number: 10,
      });
    });
  });

  it("returns null for unknown URLs", () => {
    expect(parseIssueUrl("https://jira.example.com/browse/PROJ-1")).toBeNull();
  });
});

describe("readTarget / writeTarget", () => {
  const sessionId = `test-target-${Date.now()}`;
  const dir = `/tmp/claude/${sessionId}`;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a GitHub target", async () => {
    const target = { service: "github" as const, owner: "o", repo: "r", number: 1 };
    await writeTarget(sessionId, target);
    expect(await readTarget(sessionId)).toEqual(target);
  });

  it("round-trips a Linear target", async () => {
    const target = { service: "linear" as const, identifier: "ENG-123" };
    await writeTarget(sessionId, target);
    expect(await readTarget(sessionId)).toEqual(target);
  });

  it("round-trips a GitLab target", async () => {
    const target = { service: "gitlab" as const, project: "group/project", number: 5 };
    await writeTarget(sessionId, target);
    expect(await readTarget(sessionId)).toEqual(target);
  });

  it("returns null when no target file exists", async () => {
    expect(await readTarget(`nonexistent-${Date.now()}`)).toBeNull();
  });
});
