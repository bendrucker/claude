import { describe, expect, test } from "bun:test";
import {
  commandTokens,
  commandVerbs,
  describeVerb,
  rewriteCdGit,
  segmentVerb,
  sharesVerb,
} from "./command";

describe("segmentVerb", () => {
  test.each<[string, string | null]>([
    ["bun scripts/foo.ts", "bun"],
    ["/opt/homebrew/bin/gh pr view", "gh"],
    ["FOO=1 BAR=2 bun x.ts", "bun"],
    ["cd /tmp", null],
    ["export FOO=bar", null],
    ["set -e", null],
    ["echo hello", null],
    ["FOO=bar", null],
    ["", null],
    ["-x", null],
  ])("%p resolves to %p", (segment, expected) => {
    expect(segmentVerb(segment)).toBe(expected);
  });
});

describe("commandVerbs", () => {
  test.each<{ name: string; command: string; expected: string[] }>([
    { name: "single command", command: "git status", expected: ["git"] },
    { name: "cd preamble", command: "cd /repo && git status", expected: ["git"] },
    { name: "pipeline", command: "git log | head -5", expected: ["git", "head"] },
    { name: "newline separated", command: "set -e\nbun a.ts\nnpm test", expected: ["bun", "npm"] },
    { name: "env preamble", command: "NODE_ENV=test bun test", expected: ["bun"] },
    { name: "subshell", command: "(cd /repo && git fetch)", expected: ["git"] },
    { name: "only preamble", command: "cd /repo && echo hi", expected: [] },
  ])("$name", ({ command, expected }) => {
    expect([...commandVerbs(command)]).toEqual(expected);
  });
});

describe("commandTokens", () => {
  test.each<[string, string[]]>([
    ["bun a.ts", ["bun", "a.ts"]],
    ["FOO=1 BAR=2 bun a.ts", ["bun", "a.ts"]],
    ["FOO=1", []],
    ["", []],
  ])("%p yields %p", (segment, expected) => {
    expect(commandTokens(segment)).toEqual(expected);
  });
});

describe("describeVerb", () => {
  test.each<[string, string]>([
    ["cd /repo && git status", "git"],
    ["bun a.ts && git push", "bun"],
    ["cd /repo", "cd"],
    ["echo hi", "echo"],
    ["set -e", "set"],
  ])("%p is named %p", (command, expected) => {
    expect(describeVerb(command, commandVerbs(command))).toBe(expected);
  });
});

describe("sharesVerb", () => {
  test.each<{ name: string; a: string[]; b: string[]; expected: boolean }>([
    { name: "intersects", a: ["bun", "jq"], b: ["jq"], expected: true },
    { name: "disjoint", a: ["bun"], b: ["git"], expected: false },
    { name: "empty left", a: [], b: ["git"], expected: false },
    { name: "empty right", a: ["git"], b: [], expected: false },
  ])("$name", ({ a, b, expected }) => {
    expect(sharesVerb(new Set(a), new Set(b))).toBe(expected);
  });
});

describe("rewriteCdGit", () => {
  test.each<{ name: string; command: string; expected: string }>([
    { name: "plain", command: "cd /repo && git status", expected: "git -C /repo status" },
    {
      name: "relative directory",
      command: "cd ../other && git log --oneline -5",
      expected: "git -C ../other log --oneline -5",
    },
    {
      name: "double-quoted directory",
      command: 'cd "/my repo" && git status',
      expected: 'git -C "/my repo" status',
    },
    {
      name: "single-quoted directory",
      command: "cd '/my repo' && git status",
      expected: "git -C '/my repo' status",
    },
    {
      name: "variable directory",
      command: 'cd "$WORKTREE" && git rev-parse HEAD',
      expected: 'git -C "$WORKTREE" rev-parse HEAD',
    },
    {
      name: "top-level git option in the rest",
      command: "cd /repo && git --no-pager diff",
      expected: "git -C /repo --no-pager diff",
    },
    {
      name: "loose spacing",
      command: "  cd   /repo   &&   git   status  ",
      expected: "git -C /repo status",
    },
    {
      name: "existing -C chains relative, same as cd",
      command: "cd /repo && git -C sub status",
      expected: "git -C /repo -C sub status",
    },
  ])("$name", ({ command, expected }) => {
    expect(rewriteCdGit(command)).toBe(expected);
  });

  test.each<{ name: string; command: string }>([
    { name: "no cd", command: "git status" },
    { name: "no git", command: "cd /repo && ls" },
    { name: "cd only", command: "cd /repo" },
    { name: "git with no arguments", command: "cd /repo && git" },
    { name: "second command after git", command: "cd /repo && git add . && git commit -m x" },
    { name: "semicolon separator", command: "cd /repo; git status" },
    { name: "command before the cd", command: "ls && cd /repo && git status" },
    { name: "trailing pipe", command: "cd /repo && git log | head -5" },
    { name: "output redirect", command: "cd /repo && git log > out.txt" },
    { name: "input redirect", command: "cd /repo && git apply < patch.diff" },
    { name: "backgrounded", command: "cd /repo && git fetch &" },
    { name: "command substitution in args", command: "cd /repo && git checkout `git rev-parse x`" },
    { name: "newline in the git portion", command: "cd /repo && git status\nls" },
    { name: "cd to previous directory", command: "cd - && git status" },
    { name: "two cds", command: "cd /a && cd /b && git status" },
    { name: "quoted argument holding an operator", command: 'cd /repo && git commit -m "a && b"' },
  ])("leaves $name untouched", ({ command }) => {
    expect(rewriteCdGit(command)).toBeNull();
  });
});
