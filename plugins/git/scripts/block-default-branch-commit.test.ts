import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
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

async function getOutput(
  input: PreToolUseHookInput,
  cwd: string,
): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(input, cwd);
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

  beforeEach(async () => {
    testRepo = await mkdtemp(join(tmpdir(), "git-hook-test-"));

    await $`git init -q -b main`.cwd(testRepo).quiet();
    await $`git config user.email test@example.com`.cwd(testRepo).quiet();
    await $`git config user.name "Test User"`.cwd(testRepo).quiet();
    await Bun.write(join(testRepo, "README.md"), "");
    await $`git add README.md`.cwd(testRepo).quiet();
    await $`git commit -q -m initial`.cwd(testRepo).quiet();
    await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`
      .cwd(testRepo)
      .quiet();
  });

  afterEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it("allows commit on feature branch", async () => {
    await $`git checkout -q -b feature-branch`.cwd(testRepo).quiet();
    const output = await processInput(mockInput('git commit -m "test"'), testRepo);
    expect(output).toBeNull();
  });

  it("blocks commit on main branch", async () => {
    const output = await getOutput(mockInput('git commit -m "test"'), testRepo);
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Cannot commit directly to main");
    expect(output?.permissionDecisionReason).toContain("Create a topic branch first");
  });

  it("blocks commit with additional flags", async () => {
    const output = await getOutput(mockInput('git commit -a -m "test"'), testRepo);
    expect(output?.permissionDecision).toBe("deny");
  });

  it("allows commit in detached HEAD state", async () => {
    await $`git checkout -q --detach HEAD`.cwd(testRepo).quiet();
    const output = await processInput(mockInput('git commit -m "test"'), testRepo);
    expect(output).toBeNull();
  });

  it("allows commit outside git repo", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-git-"));

    try {
      const output = await processInput(mockInput('git commit -m "test"'), outsideDir);
      expect(output).toBeNull();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
