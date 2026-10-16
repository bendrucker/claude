import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { dropFlag, parseUpstreamPush, processInput } from "./push-upstream";

describe("parseUpstreamPush", () => {
  test.each([
    ["git push -u origin HEAD", "git push origin HEAD"],
    ["git push --set-upstream origin feat", "git push origin feat"],
    ["git push -u origin HEAD 2>&1 | tail -3", "git push origin HEAD 2>&1 | tail -3"],
    [
      "git add . && git push -u origin HEAD && gh pr create",
      "git add . && git push origin HEAD && gh pr create",
    ],
    ["git push origin -u HEAD:refs/heads/feat", "git push origin HEAD:refs/heads/feat"],
    ["git push --force-with-lease -u origin +HEAD", "git push --force-with-lease origin +HEAD"],
    [
      "git -c 'credential.helper=!gh auth git-credential' push -u origin HEAD",
      "git -c 'credential.helper=!gh auth git-credential' push origin HEAD",
    ],
  ])("%s", (command, rewritten) => {
    const push = parseUpstreamPush(command);
    expect(push).not.toBeNull();
    if (push) expect(dropFlag(command, push.flag)).toBe(rewritten);
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
    await $`git -C ${main} commit -q --allow-empty -m init`.quiet();
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
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command, description: "push" },
      tool_use_id: "t",
    };
  }

  async function tracking(): Promise<string> {
    return (await $`git -C ${worktree} config --get-regexp ^branch\.feat\.`.quiet()).text();
  }

  test("records tracking in the shared config and drops -u", async () => {
    const output = await processInput(input("git push -u origin HEAD 2>&1 | tail -3"));
    expect(output?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { command: "git push origin HEAD 2>&1 | tail -3", description: "push" },
    });
    expect(await tracking()).toBe("branch.feat.remote origin\nbranch.feat.merge refs/heads/feat\n");
  });

  test("passes through a refspec naming another local branch", async () => {
    expect(await processInput(input("git push -u origin base"))).toBeNull();
  });

  test("passes through an unknown remote", async () => {
    expect(await processInput(input("git push -u upstream HEAD"))).toBeNull();
  });
});
