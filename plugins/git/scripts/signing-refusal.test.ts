import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostToolUseFailureHookInput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import {
  formatContext,
  githubRepoOf,
  hasSigningRefusal,
  processInput,
  signingRequirement,
} from "./signing-refusal";

// Captured from git 2.56 and OpenSSH 10.3 against an agent that refused to sign.
const REFUSAL = [
  "error: Signing file /tmp/.git_signing_buffer_tmpkIn3PZ",
  "Couldn't sign message (signer): agent refused operation?",
  "Signing /tmp/.git_signing_buffer_tmpkIn3PZ failed: agent refused operation?",
  "",
].join("\n");

const SIGNING_FAILURES = {
  commit: `${REFUSAL}\nfatal: failed to write commit object`,
  tag: `${REFUSAL}\nerror: unable to sign the tag\nThe tag message has been left in .git/TAG_EDITMSG`,
  rebase: `${REFUSAL}\nerror: failed to write commit object\nCould not apply 944a53d... # b`,
};

const SSH_TRANSPORT_REFUSAL = [
  'sign_and_send_pubkey: signing failed for ED25519 "SHA256:abc" from agent: agent refused operation',
  "git@github.com: Permission denied (publickey).",
  "fatal: Could not read from remote repository.",
].join("\n");

function mockInput(error: string): PostToolUseFailureHookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: "git commit -m x" },
    tool_use_id: "test",
    error,
    transcript_path: "/tmp/transcript.json",
    cwd: "/nonexistent",
  };
}

describe("hasSigningRefusal", () => {
  test.each<{ name: string; output: string; expected: boolean }>([
    { name: "commit", output: SIGNING_FAILURES.commit, expected: true },
    { name: "tag", output: SIGNING_FAILURES.tag, expected: true },
    { name: "rebase", output: SIGNING_FAILURES.rebase, expected: true },
    { name: "ssh transport refusal", output: SSH_TRANSPORT_REFUSAL, expected: false },
    {
      name: "missing signing key",
      output:
        'error: No private key found for public key "key.pub"?\n\nfatal: failed to write commit object',
      expected: false,
    },
    { name: "empty output", output: "", expected: false },
  ])("$name", ({ output, expected }) => {
    expect(hasSigningRefusal(output)).toBe(expected);
  });
});

describe("githubRepoOf", () => {
  test.each<{ name: string; url: string; expected: string | null }>([
    {
      name: "scp-style",
      url: "git@github.com:vercel/streamdown.git",
      expected: "vercel/streamdown",
    },
    { name: "https", url: "https://github.com/vercel/streamdown", expected: "vercel/streamdown" },
    {
      name: "ssh://",
      url: "ssh://git@github.com/vercel/streamdown.git\n",
      expected: "vercel/streamdown",
    },
    { name: "gitlab", url: "git@gitlab.com:owner/repo.git", expected: null },
    { name: "empty", url: "", expected: null },
  ])("$name", ({ url, expected }) => {
    expect(githubRepoOf(url)).toBe(expected);
  });
});

describe("formatContext", () => {
  test("asks the user when signing is required", () => {
    expect(formatContext("a vercel/streamdown ruleset requires signed commits on main"))
      .toMatchInlineSnapshot(`
        "Git could not sign: the SSH agent refused the signature, likely because it is locked or nobody approved it. Signing is required here because a vercel/streamdown ruleset requires signed commits on main, so an unsigned commit would be rejected on push.
        Stop and ask the user to unlock or approve the signing agent, then retry once they confirm."
      `);
  });

  test("retries unsigned when signing is optional", () => {
    expect(formatContext(null)).toMatchInlineSnapshot(`
      "Git could not sign: the SSH agent refused the signature, likely because it is locked or nobody approved it. This repository doesn't require signatures, so retry unsigned: add \`-c commit.gpgsign=false -c tag.gpgsign=false\` after \`git\`, and drop any explicit \`-S\` or \`git tag -s\`.
      A stopped rebase continues with \`git -c commit.gpgsign=false rebase --continue\`."
    `);
  });
});

describe("processInput", () => {
  test.each<{ name: string; error: string; tag: boolean }>([
    { name: "commit", error: SIGNING_FAILURES.commit, tag: false },
    { name: "tag", error: SIGNING_FAILURES.tag, tag: true },
  ])("looks up the requirement for a $name", async ({ error, tag }) => {
    const calls: boolean[] = [];
    const result = await processInput(mockInput(error), (_cwd, isTag) => {
      calls.push(isTag);
      return Promise.resolve(null);
    });
    expect(calls).toEqual([tag]);
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext: formatContext(null),
      },
    });
  });

  test("stays silent for an ssh transport refusal", async () => {
    expect(
      await processInput(mockInput(SSH_TRANSPORT_REFUSAL), () => Promise.resolve(null)),
    ).toBeNull();
  });
});

describe("signingRequirement", () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "signing-refusal-"));
    await $`git init -q -b main ${repo}`.quiet();
  });

  afterAll(() => rm(repo, { recursive: true, force: true }));

  test("is optional without a GitHub remote", async () => {
    await $`git -C ${repo} remote add origin git@gitlab.com:owner/repo.git`.quiet();
    expect(await signingRequirement(repo, false)).toBeNull();
  });

  test("is required when the repository opts in", async () => {
    await $`git -C ${repo} config claude.requireSigning true`.quiet();
    expect(await signingRequirement(repo, false)).toBe(
      "the repository sets `claude.requireSigning`",
    );
  });
});
