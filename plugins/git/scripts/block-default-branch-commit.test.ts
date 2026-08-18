import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { formatDenyOutput, invokesGitCommit, processInput } from "./block-default-branch-commit";

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

describe("invokesGitCommit", () => {
  test.each<[string, boolean]>([
    ["git commit", true],
    ['git commit -m "test"', true],
    ["git -C /repo commit -m x", true],
    ["git -c user.name=x commit", true],
    ["git --no-pager commit --amend", true],
    ["git -C /repo -c commit.gpgsign=false commit", true],
    ["git add . && git commit -m x", true],
    ["git status | tee log && git commit", true],
    ["echo hi > $TMPDIR/probe.txt", false],
    ["{ echo one; echo two; }", false],
    ["for f in *.ts; do wc -l $f; done", false],
    ["cat <<'EOF' > notes.md\nnothing here\nEOF", false],
    ["git log --oneline | head -20 | awk '{print $1}' | sort | uniq", false],
    ["git log --grep commit", false],
    ["git commit-tree $tree", false],
    ["echo 'run git commit next'", false],
    ['gh pr create --body "then git commit"', false],
  ])("%p → %p", (command, expected) => {
    expect(invokesGitCommit(command)).toBe(expected);
  });
});

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

  test.each<[string]>([['git commit -m "test"'], ['git commit -a -m "test"']])(
    "blocks %p on main branch",
    async (command) => {
      const output = await getOutput(mockInput(command), testRepo);
      expect(output?.permissionDecision).toBe("deny");
    },
  );

  // The matcher fails open on shell metacharacters, so these reach the hook on
  // the default branch even though none of them commits.
  test.each<[string]>([
    ["echo hi > $TMPDIR/probe.txt"],
    ["{ echo one; echo two; }"],
    ["for f in *.ts; do wc -l $f; done"],
    ["cat <<'EOF' > notes.md\nnothing here\nEOF"],
    ["git log --oneline | head -20 | awk '{print $1}' | sort | uniq"],
  ])("allows %p on main branch", async (command) => {
    const output = await processInput(mockInput(command), testRepo);
    expect(output).toBeNull();
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
