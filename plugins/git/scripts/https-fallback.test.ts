import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostToolUseFailureHookInput } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import {
  formatContext,
  gitNetworkSubcommand,
  hasSshAuthFailure,
  processInput,
  readRemoteUrls,
  rewriteCommand,
  usesSshGithub,
} from "./https-fallback";

const SECRETIVE_FAILURE = [
  'sign_and_send_pubkey: signing failed for RSA "SHA256:abc" from agent: agent refused operation',
  "git@github.com: Permission denied (publickey).",
  "fatal: Could not read from remote repository.",
].join("\n");

function mockInput(
  command: string,
  error: string,
  cwd = "/nonexistent",
): PostToolUseFailureHookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
    error,
    transcript_path: "/tmp/transcript.json",
    cwd,
  };
}

describe("hasSshAuthFailure", () => {
  test.each<{ name: string; output: string; expected: boolean }>([
    { name: "secretive agent refusal", output: SECRETIVE_FAILURE, expected: true },
    {
      name: "bare publickey denial",
      output: "git@github.com: Permission denied (publickey).",
      expected: true,
    },
    {
      name: "signing failure alone",
      output: "sign_and_send_pubkey: signing failed for ED25519",
      expected: true,
    },
    {
      name: "network unreachable",
      output: "ssh: connect to host github.com port 22: Network is unreachable",
      expected: false,
    },
    {
      name: "merge conflict",
      output: "CONFLICT (content): Merge conflict in README.md",
      expected: false,
    },
    { name: "empty output", output: "", expected: false },
  ])("$name", ({ output, expected }) => {
    expect(hasSshAuthFailure(output)).toBe(expected);
  });
});

describe("gitNetworkSubcommand", () => {
  test.each<{ name: string; command: string; expected: string | null }>([
    { name: "bare fetch", command: "git fetch", expected: "fetch" },
    { name: "fetch with remote", command: "git fetch origin", expected: "fetch" },
    { name: "fetch all", command: "git fetch --all --prune", expected: "fetch" },
    { name: "pull with rebase", command: "git pull --rebase origin main", expected: "pull" },
    { name: "push with upstream", command: "git push -u origin HEAD", expected: "push" },
    { name: "push force", command: "git push --force-with-lease", expected: "push" },
    { name: "clone", command: "git clone git@github.com:owner/repo.git", expected: "clone" },
    { name: "ls-remote", command: "git ls-remote origin", expected: "ls-remote" },
    { name: "submodule update", command: "git submodule update --init", expected: "submodule" },
    { name: "-C before subcommand", command: "git -C /repo fetch origin", expected: "fetch" },
    { name: "-c before subcommand", command: "git -c core.pager=cat pull", expected: "pull" },
    { name: "--no-pager before subcommand", command: "git --no-pager fetch", expected: "fetch" },
    { name: "chained after cd", command: "cd /repo && git push origin main", expected: "push" },
    {
      name: "network op in a later segment",
      command: "git status && git push origin main",
      expected: "push",
    },
    { name: "every segment local-only", command: "git add -A && git commit -m x", expected: null },
    { name: "local-only status", command: "git status", expected: null },
    { name: "local-only commit", command: "git commit -m 'x'", expected: null },
    { name: "not git at all", command: "gh pr create", expected: null },
    {
      name: "value option swallows subcommand-lookalike",
      command: "git -C push status",
      expected: null,
    },
  ])("$name", ({ command, expected }) => {
    expect(gitNetworkSubcommand(command)).toBe(expected);
  });
});

describe("usesSshGithub", () => {
  test.each<{ name: string; text: string; expected: boolean }>([
    { name: "scp-style remote", text: "git@github.com:bendrucker/claude.git", expected: true },
    { name: "ssh:// remote", text: "ssh://git@github.com/bendrucker/claude.git", expected: true },
    {
      name: "ssh:// with port",
      text: "ssh://git@github.com:22/bendrucker/claude.git",
      expected: true,
    },
    { name: "https remote", text: "https://github.com/bendrucker/claude.git", expected: false },
    { name: "gitlab ssh remote", text: "git@gitlab.com:bendrucker/claude.git", expected: false },
    { name: "enterprise host", text: "git@github.example.com:owner/repo.git", expected: false },
    { name: "no remote", text: "", expected: false },
  ])("$name", ({ text, expected }) => {
    expect(usesSshGithub(text)).toBe(expected);
  });
});

describe("rewriteCommand", () => {
  test.each<{ name: string; command: string }>([
    { name: "bare pull", command: "git pull" },
    { name: "fetch with remote", command: "git fetch origin" },
    { name: "push with upstream", command: "git push -u origin HEAD" },
    { name: "clone over ssh", command: "git clone git@github.com:owner/repo.git" },
    { name: "-C prefix preserved", command: "git -C /repo fetch --all" },
    { name: "chained after cd", command: "cd /repo && git push origin main" },
    {
      name: "targets the network op, not an earlier git",
      command: "git status && git push origin main",
    },
  ])("$name", ({ command }) => {
    expect(rewriteCommand(command)).toMatchSnapshot();
  });

  test("returns null when the line has no git invocation", () => {
    expect(rewriteCommand("gh pr create")).toBeNull();
  });

  test("does not match a word merely containing git", () => {
    expect(rewriteCommand("legit fetch")).toBeNull();
  });

  test("returns null when no segment runs a network operation", () => {
    expect(rewriteCommand("git add -A && git commit -m x")).toBeNull();
  });
});

describe("formatContext", () => {
  test("names the retry command and forbids mutating remotes", () => {
    expect(formatContext("git -c foo=bar fetch origin")).toMatchSnapshot();
  });
});

const noRemotes = async () => "";
const githubSshRemote = async () => "remote.origin.url git@github.com:bendrucker/claude.git\n";

describe("processInput", () => {
  test("suggests the HTTPS retry for a Secretive refusal on a GitHub SSH clone", async () => {
    const result = await processInput(
      mockInput("git clone git@github.com:owner/repo.git", SECRETIVE_FAILURE),
      noRemotes,
    );
    expect(result).toMatchSnapshot();
  });

  test.each<{ name: string; command: string; error: string }>([
    { name: "non-network git subcommand", command: "git status", error: SECRETIVE_FAILURE },
    {
      name: "unrelated failure",
      command: "git fetch git@github.com:owner/repo.git",
      error: "fatal: couldn't find remote ref main",
    },
    { name: "non-git command", command: "ssh git@github.com", error: SECRETIVE_FAILURE },
    {
      name: "non-github host",
      command: "git fetch git@gitlab.com:owner/repo.git",
      error: "git@gitlab.com: Permission denied (publickey).",
    },
  ])("stays silent for $name", async ({ command, error }) => {
    expect(await processInput(mockInput(command, error), noRemotes)).toBeNull();
  });

  test("stays silent when the command carries no command field", async () => {
    const input = { ...mockInput("git fetch", SECRETIVE_FAILURE), tool_input: {} };
    expect(await processInput(input, githubSshRemote)).toBeNull();
  });

  test("stays silent when a bare pull fails against a non-GitHub remote", async () => {
    const gitlabRemote = async () => "remote.origin.url git@gitlab.com:owner/repo.git\n";
    expect(await processInput(mockInput("git pull", SECRETIVE_FAILURE), gitlabRemote)).toBeNull();
  });

  test("resolves the remote from the repo when the command names none", async () => {
    const result = await processInput(mockInput("git pull", SECRETIVE_FAILURE), githubSshRemote);
    expect(result).not.toBeNull();
    const context = (result?.hookSpecificOutput as { additionalContext: string }).additionalContext;
    expect(context).toContain("url.https://github.com/.insteadOf=git@github.com:");
  });
});

describe("readRemoteUrls", () => {
  test("returns empty outside a repository", async () => {
    expect(await readRemoteUrls(tmpdir())).toBe("");
  });

  test("reads a configured remote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "https-fallback-"));
    await $`git init -q ${dir}`.quiet();
    await $`git -C ${dir} remote add origin git@github.com:owner/repo.git`.quiet();
    expect(await readRemoteUrls(dir)).toContain("git@github.com:owner/repo.git");
    await rm(dir, { recursive: true, force: true });
  });
});
