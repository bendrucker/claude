import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnRun, type CommandResult, type Run } from "./exec";
import { SETTLED_STATE, type PullRequest } from "./forge";
import {
  ageInDays,
  carriedIgnoredPaths,
  CONVENTIONAL_IGNORED,
  deriveFlags,
  filterCarried,
  isConventionalIgnored,
  isReusedBranch,
  parseWorktreeList,
  readStatus,
  type FlagInput,
} from "./worktree";

function result(overrides: Partial<CommandResult>): CommandResult {
  return { ok: true, stdout: "", stderr: "", ...overrides };
}

function flags(overrides: Partial<FlagInput>): string[] {
  return deriveFlags({
    detached: false,
    status: "clean",
    ahead: 0,
    carried: 0,
    merged: false,
    reused: false,
    pull: [],
    ...overrides,
  });
}

describe("parseWorktreeList", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD aaa",
    "branch refs/heads/main",
    "",
    "worktree /repo/wt/feature",
    "HEAD bbb",
    "branch refs/heads/feature",
    "",
    "worktree /repo/wt/spike",
    "HEAD ccc",
    "detached",
    "",
    "worktree /repo/wt/a path with spaces",
    "HEAD ddd",
    "branch refs/heads/spaced",
    "",
  ].join("\n");

  test("keeps a detached worktree the shell extractor dropped", () => {
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/repo", head: "aaa", branch: "main", detached: false },
      { path: "/repo/wt/feature", head: "bbb", branch: "feature", detached: false },
      { path: "/repo/wt/spike", head: "ccc", branch: null, detached: true },
      { path: "/repo/wt/a path with spaces", head: "ddd", branch: "spaced", detached: false },
    ]);
  });

  test("drops a bare record", () => {
    expect(parseWorktreeList("worktree /repo.git\nbare\n")).toEqual([]);
  });
});

describe("readStatus", () => {
  test.each([
    ["a clean tree", result({ stdout: "" }), "clean"],
    ["a dirty tree", result({ stdout: " M file\0?? other\0" }), "dirty"],
    ["a status git could not run", result({ ok: false, stderr: "not a repository" }), "unreadable"],
  ] as const)("%s", (_name, command, expected) => {
    expect(readStatus(command)).toBe(expected);
  });
});

describe("deriveFlags", () => {
  test("an unreadable status never reads as clean", () => {
    expect(flags({ status: "unreadable", merged: true })).toEqual(["unreadable", "merged"]);
    expect(flags({ status: "unreadable" })).not.toContain("clean");
  });

  test("an unknown ahead count never reads as pushed", () => {
    expect(flags({ ahead: null, merged: true })).toEqual(["unpushed:?", "merged"]);
  });

  test.each([
    [{}, ["clean"]],
    [{ status: "dirty" as const }, ["dirty"]],
    [{ ahead: 3 }, ["unpushed:3"]],
    [{ carried: 2 }, ["carries:2"]],
    [{ detached: true }, ["detached"]],
    [{ merged: true }, ["merged"]],
    [{ reused: true }, ["reused"]],
    [{ pull: ["failing:lint", "conflicting"] }, ["failing:lint", "conflicting"]],
    [
      {
        detached: true,
        status: "dirty" as const,
        ahead: 2,
        carried: 1,
        merged: true,
        reused: true,
        pull: ["conflicting"],
      },
      ["conflicting", "detached", "dirty", "unpushed:2", "carries:1", "merged", "reused"],
    ],
  ])("%o", (input, expected) => {
    expect(flags(input)).toEqual(expected);
  });
});

describe("filterCarried", () => {
  test("drops conventional build and dependency paths at any depth", () => {
    expect(
      filterCarried([
        "node_modules/",
        "packages/api/node_modules/",
        ".venv/",
        "target/debug/",
        "tmp/scratch.json",
        ".claude/settings.local.json",
        "app/tsconfig.tsbuildinfo",
        "next-env.d.ts",
        "server.log",
        "coverage.out",
      ]),
    ).toEqual([]);
  });

  test("keeps the files a recursive removal would destroy", () => {
    expect(filterCarried([".env", "data/local.sqlite", "notes.md", ".dev.vars"])).toEqual([
      ".env",
      "data/local.sqlite",
      "notes.md",
      ".dev.vars",
    ]);
  });

  test("every constant entry matches something", () => {
    for (const entry of CONVENTIONAL_IGNORED) {
      const sample = entry.endsWith("/")
        ? `nested/${entry}`
        : entry.startsWith("*")
          ? `nested/sample${entry.slice(1)}`
          : `nested/${entry}`;
      expect(isConventionalIgnored(sample)).toBe(true);
    }
  });
});

describe("ageInDays", () => {
  const now = 1_000_000;
  test.each([
    [now, 0],
    [now - 86_400, 1],
    [now - 86_400 * 30 - 3600, 30],
    [null, null],
  ])("%s", (commit, expected) => {
    expect(ageInDays(commit, now)).toBe(expected);
  });
});

describe("isReusedBranch", () => {
  const merged: PullRequest = {
    branch: "gzip",
    number: 2,
    state: "merged",
    mergedAt: 1000,
    ...SETTLED_STATE,
  };

  test.each([
    ["a commit after the merge", merged, 2000, true],
    ["a commit before the merge", merged, 500, false],
    ["an open pull request", { ...merged, state: "open" as const }, 2000, false],
    ["a merge with no timestamp", { ...merged, mergedAt: null }, 2000, false],
    ["no branch date", merged, null, false],
    ["no pull request", undefined, 2000, false],
  ])("%s", (_name, pull, commit, expected) => {
    expect(isReusedBranch(pull, commit)).toBe(expected);
  });
});

describe("carriedIgnoredPaths", () => {
  test("collapses an ignored directory instead of walking it", async () => {
    const root = await mkdtemp(join(tmpdir(), "flock-carry-"));
    try {
      await Bun.write(join(root, ".gitignore"), "node_modules/\n.env\ndata/\n");
      await Bun.write(join(root, "node_modules/pkg/index.js"), "");
      await Bun.write(join(root, "data/local.sqlite"), "");
      await Bun.write(join(root, ".env"), "SECRET=1");
      await Bun.write(join(root, "src/main.ts"), "");
      await spawnRun(["git", "init", "-q"], { cwd: root });

      expect((await carriedIgnoredPaths(spawnRun, root)).toSorted()).toEqual([".env", "data/"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a repository check-ignore cannot read carries nothing", async () => {
    const run: Run = () => Promise.resolve(result({ ok: false }));
    expect(await carriedIgnoredPaths(run, "/nonexistent")).toEqual([]);
  });
});
