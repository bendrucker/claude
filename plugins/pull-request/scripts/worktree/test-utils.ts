import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface TestRepo {
  repoPath: string;
  worktreePath: string;
  cleanup: () => void;
}

export function createTestRepo(prefix: string): TestRepo {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
  const worktreePath = `${repoPath}-wt`;

  execSync("git init -q -b main", { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: "pipe" });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# Test");
  execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
  execSync('git commit -q -m "Initial commit"', { cwd: repoPath, stdio: "pipe" });

  return {
    repoPath,
    worktreePath,
    cleanup() {
      try {
        execSync(`git worktree remove "${worktreePath}" --force 2>/dev/null || true`, {
          cwd: repoPath,
          stdio: "pipe",
        });
      } catch {
        // ignore
      }
      fs.rmSync(repoPath, { recursive: true, force: true });
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    },
  };
}

export function createRunner(scriptPath: string) {
  return function runScript(args: string[], cwd?: string): string {
    const quotedArgs = args.map((a) => `"${a}"`).join(" ");
    return execSync(`"${scriptPath}" ${quotedArgs}`, {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  };
}
