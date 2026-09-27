import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crossRepoReason,
  processInput,
  sameDirectoryReason,
  unmanagedReason,
  worktreeSessionActive,
} from "./index";

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(
    dir,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
}

function addWorktree(repo: string, path: string, branch: string): void {
  git(repo, "worktree", "add", "-q", "-b", branch, path);
}

const worktreeState = (worktreePath: string | null) =>
  JSON.stringify({
    type: "worktree-state",
    worktreeSession: worktreePath == null ? null : { worktreePath, worktreeName: "w" },
    sessionId: "s",
  });

let root: string;
let repo: string;
let sibling: string;
let managed: string;
let other: string;
let plain: string;
const transcripts: Record<string, string> = {};

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "enter-worktree-")));
  repo = join(root, "repo");
  initRepo(repo);
  sibling = join(repo, ".worktrees", "sibling");
  addWorktree(repo, sibling, "sibling");
  managed = join(repo, ".claude", "worktrees", "managed");
  addWorktree(repo, managed, "managed");
  other = join(root, "other");
  initRepo(other);
  plain = join(root, "plain");
  mkdirSync(plain);

  const lines = {
    entered: [
      worktreeState(null),
      '{"type":"user"}',
      worktreeState(sibling),
      '{"type":"assistant"}',
    ],
    exited: [worktreeState(sibling), worktreeState(null), '{"type":"assistant"}'],
    unknown: ['{"type":"user"}', '{"type":"assistant"}'],
  };
  await Promise.all(
    Object.entries(lines).map(([name, content]) => {
      transcripts[name] = join(root, `${name}.jsonl`);
      return Bun.write(transcripts[name], `${content.join("\n")}\n`);
    }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("worktreeSessionActive", () => {
  test.each([
    ["entered", true],
    ["exited", false],
    ["unknown", undefined],
  ])("%s transcript", async (name, expected) => {
    expect(await worktreeSessionActive(transcripts[name]!)).toBe(expected);
  });

  test("missing transcript is unknown", async () => {
    expect(await worktreeSessionActive(join(root, "absent.jsonl"))).toBeUndefined();
  });
});

describe("processInput", () => {
  interface Case {
    name: string;
    cwd: () => string;
    path: () => string | undefined;
    transcript?: string;
    agent?: boolean;
    reason: (() => string) | null;
  }

  const cases: Case[] = [
    {
      name: "name-only creation passes",
      cwd: () => repo,
      path: () => undefined,
      transcript: "entered",
      reason: null,
    },
    {
      name: "target is the working directory",
      cwd: () => sibling,
      path: () => sibling,
      transcript: "unknown",
      reason: () => sameDirectoryReason(sibling),
    },
    {
      name: "target in another repository",
      cwd: () => repo,
      path: () => other,
      transcript: "unknown",
      reason: () => crossRepoReason(other),
    },
    {
      name: "cross-repo holds regardless of session state",
      cwd: () => sibling,
      path: () => other,
      transcript: "exited",
      reason: () => crossRepoReason(other),
    },
    {
      name: "unmanaged target after switching",
      cwd: () => managed,
      path: () => sibling,
      transcript: "entered",
      reason: () => unmanagedReason(sibling, join(repo, ".claude", "worktrees")),
    },
    {
      name: "unmanaged target from the main checkout before switching",
      cwd: () => repo,
      path: () => sibling,
      transcript: "exited",
      reason: null,
    },
    {
      name: "unmanaged target from a linked worktree the session started in",
      cwd: () => managed,
      path: () => sibling,
      transcript: "unknown",
      reason: null,
    },
    {
      name: "managed target after switching",
      cwd: () => sibling,
      path: () => managed,
      transcript: "entered",
      reason: null,
    },
    {
      name: "subagent calls skip the session-state rule",
      cwd: () => managed,
      path: () => sibling,
      transcript: "entered",
      agent: true,
      reason: null,
    },
    {
      name: "relative target resolves against cwd",
      cwd: () => repo,
      path: () => "../other",
      transcript: "unknown",
      reason: () => crossRepoReason("../other"),
    },
    {
      name: "missing target passes",
      cwd: () => repo,
      path: () => join(repo, ".worktrees", "absent"),
      transcript: "entered",
      reason: null,
    },
    {
      name: "cwd outside any repository passes",
      cwd: () => plain,
      path: () => sibling,
      transcript: "entered",
      reason: null,
    },
  ];

  test.each(cases)("$name", async ({ cwd, path, transcript, agent, reason }) => {
    const output = await processInput({
      cwd: cwd(),
      agent_id: agent === true ? "agent" : undefined,
      transcript_path: transcript == null ? undefined : transcripts[transcript],
      tool_input: { path: path() },
    });
    if (reason == null) {
      expect(output).toBeNull();
    } else {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason(),
        },
      });
    }
  });
});

test("reasons", () => {
  expect({
    same: sameDirectoryReason("/src/repo/.worktrees/topic"),
    crossRepo: crossRepoReason("/src/other/.worktrees/topic"),
    unmanaged: unmanagedReason("/src/repo/.worktrees/topic", "/src/repo/.claude/worktrees"),
  }).toMatchInlineSnapshot(`
    {
      "crossRepo": "\`/src/other/.worktrees/topic\` belongs to a different repository than this session, and EnterWorktree only enters worktrees of the session's own repository. For work that becomes its own pull request, dispatch a sibling agent into it through the \`herdr:herdr\` skill. For read-only work, spawn an \`Agent\` with \`cwd\` set to \`/src/other/.worktrees/topic\`.",
      "same": "\`/src/repo/.worktrees/topic\` is already the working directory. Keep working here.",
      "unmanaged": "This session has already switched into a worktree, and from here EnterWorktree only enters worktrees under \`/src/repo/.claude/worktrees/\`. Work in \`/src/repo/.worktrees/topic\` from the current session with \`git -C /src/repo/.worktrees/topic\` and absolute paths.",
    }
  `);
});
