import { execSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunner, createTestRepo, type TestRepo } from "./test-utils";

const runScript = createRunner(path.join(import.meta.dirname, "wt-resolve.sh"));

describe("wt-resolve.sh", () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo("wt-resolve-test");
  });

  afterEach(() => {
    repo.cleanup();
  });

  it("outputs nothing when branch is empty", () => {
    const result = runScript([""], repo.repoPath);
    expect(result).toBe("");
  });

  it("outputs nothing when branch not in worktree", () => {
    const result = runScript(["nonexistent-branch"], repo.repoPath);
    expect(result).toBe("");
  });

  it("outputs worktree path when branch exists in worktree", () => {
    execSync(`git worktree add "${repo.worktreePath}" -b feature-branch`, {
      cwd: repo.repoPath,
      stdio: "pipe",
    });

    const result = runScript(["feature-branch"], repo.repoPath);
    expect(result).toBe(repo.worktreePath);
  });

  it("handles branches with slashes in name", () => {
    execSync(`git worktree add "${repo.worktreePath}" -b feature/nested/branch`, {
      cwd: repo.repoPath,
      stdio: "pipe",
    });

    const result = runScript(["feature/nested/branch"], repo.repoPath);
    expect(result).toBe(repo.worktreePath);
  });
});
