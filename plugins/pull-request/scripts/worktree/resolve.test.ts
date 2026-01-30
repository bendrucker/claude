import { execSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestRepo, type TestRepo } from "./test-utils";

const scriptPath = path.join(import.meta.dirname, "resolve.ts");

function runScript(args: string[], cwd?: string): string {
  const quotedArgs = args.map((a) => `"${a}"`).join(" ");
  return execSync(`bun "${scriptPath}" ${quotedArgs}`, {
    encoding: "utf-8",
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe("resolve.ts", () => {
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
