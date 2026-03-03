import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestRepo, type TestRepo } from "./worktree/test-utils";

const scriptPath = path.join(import.meta.dirname, "git-context.ts");

function runScript(args: string[], cwd?: string): string {
  const quotedArgs = args.map((a) => `"${a}"`).join(" ");
  return execSync(`bun "${scriptPath}" ${quotedArgs}`, {
    encoding: "utf-8",
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe("git-context.ts", () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = createTestRepo("git-context-test");
  });

  afterEach(() => {
    repo.cleanup();
  });

  it("outputs context for current directory when no branch given", () => {
    const result = runScript([], repo.repoPath);
    expect(result).toContain("Branch: main");
    expect(result).toContain("Log:");
    expect(result).toContain("Initial commit");
  });

  it("outputs context for worktree when branch given", () => {
    execSync(`git worktree add "${repo.worktreePath}" -b feature-branch`, {
      cwd: repo.repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(path.join(repo.worktreePath, "new-file.txt"), "hello");
    execSync("git add new-file.txt", { cwd: repo.worktreePath, stdio: "pipe" });

    const result = runScript(["feature-branch"], repo.repoPath);
    expect(result).toContain("Branch: feature-branch");
    expect(result).toContain("Status:");
    expect(result).toContain("new-file.txt");
  });

  it("falls back to cwd when branch not found in worktree", () => {
    const result = runScript(["nonexistent-branch"], repo.repoPath);
    expect(result).toContain("Branch: main");
  });
});
