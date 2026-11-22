import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { parseUpstreamPush, processInput } from "./push-upstream";

describe("parseUpstreamPush", () => {
  test.each([
    "git push -u origin HEAD",
    "git push --set-upstream origin feat",
    "git push -u origin HEAD 2>&1 | tail -3",
    "git add . && git push -u origin HEAD && gh pr create",
    "git push origin -u HEAD:refs/heads/feat",
    "git push --force-with-lease -u origin +HEAD",
    "git -c 'credential.helper=!gh auth git-credential' push -u origin HEAD",
  ])("%s", (command) => {
    expect(parseUpstreamPush(command)).not.toBeNull();
  });

  test.each([
    "git push origin HEAD",
    "git push -u",
    "git push -u origin",
    "git push -u origin a b",
    "git push -u --tags origin HEAD",
    "git push -uf origin HEAD",
    "git push -u origin 'HEAD'",
    "git -C ../other push -u origin HEAD",
    "cd ../other && git push -u origin HEAD",
    "git log --grep push -u",
    "echo git push -u origin HEAD",
  ])("ignores %s", (command) => {
    expect(parseUpstreamPush(command)).toBeNull();
  });

  test("reads the refspec destination", () => {
    expect(parseUpstreamPush("git push -u origin HEAD:refs/heads/feat")).toMatchObject({
      remote: "origin",
      source: "HEAD",
      destination: "feat",
    });
  });
});

describe("processInput", () => {
  let root: string;
  let worktree: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "push-upstream-"));
    const main = join(root, "main");
    worktree = join(root, "wt");
    await $`git init -q -b main ${main}`.quiet();
    await $`git -C ${main} -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false commit -q --allow-empty -m init`.quiet();
    await $`git -C ${main} remote add origin ${join(root, "remote.git")}`.quiet();
    await $`git -C ${main} branch base`.quiet();
    await $`git -C ${main} worktree add -q -b feat ${worktree}`.quiet();
    // A worktree created from a base branch tracks that base.
    await $`git -C ${worktree} branch -q --set-upstream-to=base`.quiet();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function input(command: string): PreToolUseHookInput {
    return {
      session_id: "test",
      transcript_path: "",
      cwd: worktree,
      permission_mode: "auto",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command, description: "push" },
      tool_use_id: "t",
    };
  }

  async function tracking(): Promise<string> {
    return (await $`git -C ${worktree} config --get-regexp ^branch\.feat\.`.quiet()).text();
  }

  test("records tracking in the shared config and leaves the command unchanged", async () => {
    const output = await processInput(input("git push -u origin HEAD 2>&1 | tail -3"));
    const hook = output?.hookSpecificOutput;
    expect(hook).toHaveProperty("additionalContext");
    expect(hook).not.toHaveProperty("updatedInput");
    expect(hook).not.toHaveProperty("permissionDecision");
    expect(await tracking()).toBe("branch.feat.remote origin\nbranch.feat.merge refs/heads/feat\n");
  });

  test("a push -u that cannot lock the config still lands and exits 0", async () => {
    await $`git init -q --bare ${join(root, "remote.git")}`.quiet();
    await processInput(input("git push -u origin HEAD"));
    // A held lock fails -u's config write the way the sandbox's deny does.
    await Bun.write(join(root, "main", ".git", "config.lock"), "");
    try {
      const push = await $`git -C ${worktree} push -u origin HEAD`.quiet().nothrow();
      expect(push.stderr.toString()).toContain("could not lock config file");
      expect(push.exitCode).toBe(0);
      const remote = await $`git -C ${worktree} ls-remote origin refs/heads/feat`.quiet();
      expect(remote.text()).toContain("refs/heads/feat");
      expect(await tracking()).toBe("branch.feat.remote origin\nbranch.feat.merge refs/heads/feat\n");
    } finally {
      await rm(join(root, "main", ".git", "config.lock"), { force: true });
    }
  });

  test("passes through a refspec naming another local branch", async () => {
    expect(await processInput(input("git push -u origin base"))).toBeNull();
  });

  test("passes through an unknown remote", async () => {
    expect(await processInput(input("git push -u upstream HEAD"))).toBeNull();
  });
});
