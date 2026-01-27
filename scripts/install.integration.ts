import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("install.sh", () => {
  let tempClaudeRepo: string;
  let tempClaudeDir: string;
  let tempExternalProject: string;
  const repoRoot = join(import.meta.dirname, "..");

  beforeEach(() => {
    tempClaudeRepo = mkdtempSync(join(tmpdir(), "claude-repo-"));
    tempClaudeDir = mkdtempSync(join(tmpdir(), "claude-dir-"));
    tempExternalProject = mkdtempSync(join(tmpdir(), "external-project-"));

    execSync(`cp -R "${repoRoot}/user" "${tempClaudeRepo}/user"`);
    execSync(`cp -R "${repoRoot}/scripts" "${tempClaudeRepo}/scripts"`);
  });

  afterEach(() => {
    rmSync(tempClaudeRepo, { recursive: true, force: true });
    rmSync(tempClaudeDir, { recursive: true, force: true });
    rmSync(tempExternalProject, { recursive: true, force: true });
  });

  it("creates symlinks with valid targets", () => {
    execSync(`CLAUDE_REPO_HOME="${tempClaudeRepo}" HOME="${tempClaudeDir}" ./scripts/install.sh`, {
      cwd: tempClaudeRepo,
      stdio: "pipe",
    });

    const claudeDir = join(tempClaudeDir, ".claude");
    const expectedSymlinks = ["CLAUDE.md", "settings.json", "hooks", "README.md"];

    for (const name of expectedSymlinks) {
      const symlinkPath = join(claudeDir, name);
      expect(existsSync(symlinkPath), `${name} symlink should exist`).toBe(true);

      const target = readlinkSync(symlinkPath);
      expect(existsSync(target), `${name} target should exist: ${target}`).toBe(true);
    }
  });

  it("hooks resolve from external project directory", () => {
    execSync(`CLAUDE_REPO_HOME="${tempClaudeRepo}" HOME="${tempClaudeDir}" ./scripts/install.sh`, {
      cwd: tempClaudeRepo,
      stdio: "pipe",
    });

    const hookPath = join(tempClaudeDir, ".claude", "hooks", "worktree");
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });

    const result = execSync(`echo '${input}' | bun "${hookPath}"`, {
      cwd: tempExternalProject,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    expect(result).toBe("");
  });
});
