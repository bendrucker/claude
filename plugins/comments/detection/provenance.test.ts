import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  authorSignal,
  type BlamedLine,
  commitSignals,
  parseLinePorcelain,
  ProvenanceIndex,
  provenanceOf,
} from "./provenance";
import type { Comment } from "./types";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const ZERO = "0".repeat(40);

const porcelain = [
  `${SHA_A} 1 1 2`,
  "author Ada",
  "author-mail <ada@example.com>",
  "author-time 1700000000",
  "summary first",
  "\t// one",
  `${SHA_A} 2 2`,
  "author Ada",
  "author-mail <ada@example.com>",
  "author-time 1700000000",
  "\t// two",
  `${ZERO} 3 3 1`,
  "author Not Committed Yet",
  "author-mail <not.committed.yet>",
  "author-time 1750000000",
  "\t// three",
  `${SHA_B} 1 4 1`,
  "author Claude",
  "author-mail <noreply@anthropic.com>",
  "author-time 1760000000",
  "\t// four",
  "",
].join("\n");

const comment = (startLine: number, endLine = startLine): Comment => ({
  kind: "line",
  text: "// c",
  startLine,
  endLine,
  startColumn: 0,
  endColumn: 4,
});

describe("parseLinePorcelain", () => {
  test("maps each final line to its commit and author", () => {
    const blame = parseLinePorcelain(porcelain);
    expect([...blame.keys()]).toEqual([1, 2, 3, 4]);
    expect(blame.get(1)).toEqual({
      sha: SHA_A,
      author: "Ada",
      mail: "ada@example.com",
      time: 1700000000,
    });
    expect(blame.get(3)?.sha).toBe(ZERO);
    expect(blame.get(4)?.mail).toBe("noreply@anthropic.com");
  });
});

describe("commitSignals", () => {
  test.each<[string, string[]]>([
    ["plain subject\n\nbody", []],
    ["subject\n\nCo-authored-by: Ada <ada@example.com>", []],
    [
      "subject\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      ["Co-Authored-By: Claude <noreply@anthropic.com>"],
    ],
    [
      "subject\n\nClaude-Session: https://claude.ai/code/session_01ABC",
      ["Claude-Session: https://claude.ai/code/session_01ABC"],
    ],
    [
      "subject\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      ["🤖 Generated with [Claude Code](https://claude.com/claude-code)"],
    ],
    [
      "subject\n\nCo-authored-by: renovate[bot] <1+renovate[bot]@users.noreply.github.com>",
      ["Co-authored-by: renovate[bot] <1+renovate[bot]@users.noreply.github.com>"],
    ],
  ])("%j", (message, expected) => {
    expect(commitSignals(message)).toEqual(expected);
  });
});

describe("authorSignal", () => {
  const line = (author: string, mail: string): BlamedLine => ({
    sha: SHA_A,
    author,
    mail,
    time: 0,
  });
  test.each<[string, string, string | null]>([
    ["Ada", "ada@example.com", null],
    ["Claude", "noreply@anthropic.com", "author: Claude <noreply@anthropic.com>"],
    [
      "dependabot[bot]",
      "x@users.noreply.github.com",
      "author: dependabot[bot] <x@users.noreply.github.com>",
    ],
  ])("%s <%s>", (author, mail, expected) => {
    expect(authorSignal(line(author, mail))).toBe(expected);
  });
});

describe("provenanceOf", () => {
  const blame = parseLinePorcelain(porcelain);
  const signals = new Map([[SHA_A, ["Claude-Session: https://claude.ai/code/session_01ABC"]]]);

  test.each<[string, Comment, ReturnType<typeof provenanceOf>]>([
    [
      "committed lines carry their authors, date, and commit signals",
      comment(1, 2),
      {
        uncommitted: false,
        authors: ["Ada"],
        latest: "2023-11-14",
        signals: ["Claude-Session: https://claude.ai/code/session_01ABC"],
      },
    ],
    [
      "an uncommitted line marks the comment uncommitted",
      comment(2, 3),
      {
        uncommitted: true,
        authors: ["Ada"],
        latest: "2023-11-14",
        signals: ["Claude-Session: https://claude.ai/code/session_01ABC"],
      },
    ],
    [
      "an agent author is a signal of its own",
      comment(4),
      {
        uncommitted: false,
        authors: ["Claude"],
        latest: "2025-10-09",
        signals: ["author: Claude <noreply@anthropic.com>"],
      },
    ],
    [
      "a line the blame lacks counts as uncommitted",
      comment(9),
      { uncommitted: true, authors: [], latest: null, signals: [] },
    ],
  ])("%s", (_, target, expected) => {
    expect(provenanceOf(target, blame, signals)).toEqual(expected);
  });
});

describe("ProvenanceIndex", () => {
  let dir: string;
  let prevCwd: string;

  const git = (...args: string[]) =>
    $`git ${args}`
      .cwd(dir)
      .env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" })
      .quiet();

  beforeEach(async () => {
    prevCwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "comments-provenance-"));
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "ada@example.com");
    await git("config", "user.name", "Ada");
    await Bun.write(join(dir, "a.ts"), "// one\n// two\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "first\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    await Bun.write(join(dir, "a.ts"), "// one\n// two\n// three\n");
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test("blames a tracked file and reads the signals off its commits", async () => {
    const index = new ProvenanceIndex();
    const [committed, pending] = await index.forFile("a.ts", [comment(1, 2), comment(3)]);
    expect(committed).toMatchObject({
      uncommitted: false,
      authors: ["Ada"],
      signals: ["Co-Authored-By: Claude <noreply@anthropic.com>"],
    });
    expect(committed?.latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pending).toEqual({ uncommitted: true, authors: [], latest: null, signals: [] });
  });

  test("treats an untracked file as wholly uncommitted", async () => {
    await Bun.write(join(dir, "new.ts"), "// fresh\n");
    const index = new ProvenanceIndex();
    expect(await index.forFile("new.ts", [comment(1)])).toEqual([
      { uncommitted: true, authors: [], latest: null, signals: [] },
    ]);
  });
});
