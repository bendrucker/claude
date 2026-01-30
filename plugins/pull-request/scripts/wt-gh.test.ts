import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunner, createTestRepo, type TestRepo } from "./test-utils";

const runScript = createRunner(path.join(import.meta.dirname, "wt-gh.sh"));

describe("wt-gh.sh", () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo("wt-gh-test");
  });

  afterEach(() => {
    repo.cleanup();
  });

  it("passes through when no branch argument given", () => {
    const result = runScript(["", "--version"], repo.repoPath);
    expect(result).toMatch(/gh version/);
  });

  it("runs in current directory when branch not in worktree", () => {
    const result = runScript(["nonexistent-branch", "--version"], repo.repoPath);
    expect(result).toMatch(/gh version/);
  });
});
