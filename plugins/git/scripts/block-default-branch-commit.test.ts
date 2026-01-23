import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatDenyOutput, processInput } from "./block-default-branch-commit";

function mockInput(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

function getOutput(input: PreToolUseHookInput): PreToolUseHookSpecificOutput | null {
  const result = processInput(input);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("formatDenyOutput", () => {
  it("formats deny output with branch name", () => {
    const output = formatDenyOutput("main");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Cannot commit directly to main. Create a topic branch first with: git checkout -b <branch-name>",
      },
    });
  });
});

describe("processInput", () => {
  let testRepo: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), "git-hook-test-"));
    process.chdir(testRepo);

    execSync("git init -q -b main", { stdio: "pipe" });
    execSync('git config user.email "test@example.com"', { stdio: "pipe" });
    execSync('git config user.name "Test User"', { stdio: "pipe" });
    fs.writeFileSync(path.join(testRepo, "README.md"), "");
    execSync("git add README.md", { stdio: "pipe" });
    execSync('git commit -q -m "Initial commit"', { stdio: "pipe" });
    execSync("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main", {
      stdio: "pipe",
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRepo, { recursive: true, force: true });
  });

  it("allows commit on feature branch", () => {
    execSync("git checkout -q -b feature-branch", { stdio: "pipe" });
    const output = processInput(mockInput('git commit -m "test"'));
    expect(output).toBeNull();
  });

  it("blocks commit on main branch", () => {
    const output = getOutput(mockInput('git commit -m "test"'));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Cannot commit directly to main");
    expect(output?.permissionDecisionReason).toContain("Create a topic branch first");
  });

  it("blocks commit with additional flags", () => {
    const output = getOutput(mockInput('git commit -a -m "test"'));
    expect(output?.permissionDecision).toBe("deny");
  });

  it("allows commit in detached HEAD state", () => {
    execSync("git checkout -q --detach HEAD", { stdio: "pipe" });
    const output = processInput(mockInput('git commit -m "test"'));
    expect(output).toBeNull();
  });

  it("allows commit outside git repo", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "outside-git-"));
    process.chdir(outsideDir);

    try {
      const output = processInput(mockInput('git commit -m "test"'));
      expect(output).toBeNull();
    } finally {
      process.chdir(testRepo);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
