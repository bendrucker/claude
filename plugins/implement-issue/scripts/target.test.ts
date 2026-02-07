import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { parseIssueUrl, readTarget, writeTarget } from "./target";

describe("parseIssueUrl", () => {
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

  it("returns null for non-GitHub URLs", () => {
    expect(parseIssueUrl("https://gitlab.com/owner/repo/issues/1")).toBeNull();
  });

  it("returns null for issue list URL", () => {
    expect(parseIssueUrl("https://github.com/owner/repo/issues")).toBeNull();
  });
});

describe("readTarget / writeTarget", () => {
  const sessionId = `test-target-${Date.now()}`;
  const dir = `/tmp/claude/${sessionId}`;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a target", () => {
    const target = { service: "github" as const, owner: "o", repo: "r", number: 1 };
    writeTarget(sessionId, target);
    expect(readTarget(sessionId)).toEqual(target);
  });

  it("returns null when no target file exists", () => {
    expect(readTarget(`nonexistent-${Date.now()}`)).toBeNull();
  });
});
