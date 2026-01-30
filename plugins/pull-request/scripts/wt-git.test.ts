import { execSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunner, createTestRepo, type TestRepo } from "./test-utils";

const runScript = createRunner(path.join(import.meta.dirname, "wt-git.sh"));

describe("wt-git.sh", () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo("wt-git-test");
  });

  afterEach(() => {
    repo.cleanup();
  });

  it("passes through when no branch argument given", () => {
    const result = runScript(["", "branch", "--show-current"], repo.repoPath);
    expect(result).toBe("main");
  });

  it("runs in current directory when branch not in worktree", () => {
    const result = runScript(["nonexistent-branch", "branch", "--show-current"], repo.repoPath);
    expect(result).toBe("main");
  });

  it("resolves branch to worktree path and runs there", () => {
    execSync(`git worktree add "${repo.worktreePath}" -b feature-branch`, {
      cwd: repo.repoPath,
      stdio: "pipe",
    });

    const result = runScript(["feature-branch", "branch", "--show-current"], repo.repoPath);
    expect(result).toBe("feature-branch");
  });

  it("handles branches with slashes in name", () => {
    execSync(`git worktree add "${repo.worktreePath}" -b feature/nested/branch`, {
      cwd: repo.repoPath,
      stdio: "pipe",
    });

    const result = runScript(["feature/nested/branch", "branch", "--show-current"], repo.repoPath);
    expect(result).toBe("feature/nested/branch");
  });
});
