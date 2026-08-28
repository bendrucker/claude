import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AddedLineStats,
  addedLines,
  baselineFor,
  densityScore,
  emptyStats,
  measureAddedLines,
  type ScoredFile,
  scoreTranscript,
  sessionScore,
  type Tier,
} from "./density";

const allAdded = (fragment: string) => new Set(fragment.split("\n").map((_, i) => i + 1));

const measure = (fragment: string, language: string) =>
  measureAddedLines(fragment, allAdded(fragment), language);

const stats = (overrides: Partial<AddedLineStats>): AddedLineStats => ({
  ...emptyStats(),
  ...overrides,
});

describe("measureAddedLines", () => {
  test.each<[string, string, AddedLineStats]>([
    [
      "typescript",
      ["// adds two numbers", "const x = 1; // trailing", "const y = 2;"].join("\n"),
      {
        addedLines: 3,
        commentChars: 26,
        codeChars: 18,
        commentLines: 1,
        codeLines: 1,
        mixedLines: 1,
        commentWords: 4,
        commentCount: 2,
        maxCommentChars: 19,
      },
    ],
    [
      "go",
      ["package main", "", "// hello prints", "func hello() {}"].join("\n"),
      {
        addedLines: 3,
        commentChars: 13,
        codeChars: 24,
        commentLines: 1,
        codeLines: 2,
        mixedLines: 0,
        commentWords: 2,
        commentCount: 1,
        maxCommentChars: 15,
      },
    ],
    [
      "python",
      ["# top comment", "x = 1"].join("\n"),
      {
        addedLines: 2,
        commentChars: 11,
        codeChars: 3,
        commentLines: 1,
        codeLines: 1,
        mixedLines: 0,
        commentWords: 2,
        commentCount: 1,
        maxCommentChars: 13,
      },
    ],
    [
      "shellscript",
      ["# say hi", "echo hi"].join("\n"),
      {
        addedLines: 2,
        commentChars: 6,
        codeChars: 6,
        commentLines: 1,
        codeLines: 1,
        mixedLines: 0,
        commentWords: 2,
        commentCount: 1,
        maxCommentChars: 8,
      },
    ],
  ])("%s fragment", async (language, fragment, expected) => {
    expect(await measure(fragment, language)).toEqual(expected);
  });

  test("exempt directive comments count as code", async () => {
    const fragment = ["// eslint-disable-next-line no-console", 'console.log("hi");'].join("\n");
    const result = await measure(fragment, "typescript");
    expect(result.commentChars).toBe(0);
    expect(result.commentCount).toBe(0);
    expect(result.codeLines).toBe(2);
  });

  test("only added lines are measured", async () => {
    const fragment = ["// old comment", "const x = 1;"].join("\n");
    const result = await measureAddedLines(fragment, new Set([2]), "typescript");
    expect(result).toEqual(stats({ addedLines: 1, codeChars: 9, codeLines: 1 }));
  });

  test("unknown language extracts no comments, so lines measure as code", async () => {
    expect(await measure("hello", "not-a-language")).toEqual(
      stats({ addedLines: 1, codeChars: 5, codeLines: 1 }),
    );
  });
});

describe("addedLines", () => {
  test("moved line is not added", () => {
    const { added } = addedLines("a\nb", "b\na");
    expect(added.size).toBe(0);
  });

  test("duplicate counts once per extra occurrence", () => {
    const { added } = addedLines("a", "a\na\na");
    expect([...added].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  test("changed line is added at its new index", () => {
    const { added } = addedLines("a\nb", "a\nc");
    expect([...added]).toEqual([2]);
  });
});

describe("densityScore", () => {
  test("empty stats score zero", () => {
    expect(densityScore(emptyStats(), "typescript")).toEqual({
      share: 0,
      wordsPerCodeLine: 0,
      excessChars: 0,
    });
  });

  test("share, wordsPerCodeLine, excess over the language baseline", () => {
    const score = densityScore(
      stats({ commentChars: 100, codeChars: 100, commentWords: 20, codeLines: 5 }),
      "typescript",
    );
    expect(score.share).toBe(0.5);
    expect(score.wordsPerCodeLine).toBe(4);
    const b = baselineFor("typescript");
    expect(score.excessChars).toBeCloseTo(100 - (b / (1 - b)) * 100, 5);
  });

  test("comment share at the baseline has no excess", () => {
    const b = baselineFor("go");
    expect(b).toBe(0.22);
    const score = densityScore(stats({ commentChars: 220, codeChars: 780 }), "go");
    expect(score.excessChars).toBe(0);
  });

  test("unlisted language falls back to the default baseline", () => {
    expect(baselineFor("kotlin")).toBe(0.1);
  });
});

describe("sessionScore tiers", () => {
  const file = (
    path: string,
    overrides: Partial<AddedLineStats>,
    language = "typescript",
  ): ScoredFile => ({
    path,
    language,
    stats: stats(overrides),
  });

  test.each<[string, ScoredFile[], Tier]>([
    [
      "docs-pass share never escalates despite huge excess",
      [file("a.ts", { commentChars: 2000, codeChars: 100, addedLines: 30 })],
      "docs-pass",
    ],
    [
      "total excess over the strong threshold",
      [file("a.ts", { commentChars: 2900, codeChars: 1000, addedLines: 30 })],
      "strong",
    ],
    [
      "session share over the report threshold",
      [file("a.ts", { commentChars: 800, codeChars: 600, addedLines: 30 })],
      "report",
    ],
    [
      "wordsPerCodeLine over the report threshold",
      [
        file("a.ts", {
          commentChars: 800,
          codeChars: 500,
          commentWords: 100,
          codeLines: 40,
          addedLines: 30,
        }),
      ],
      "report",
    ],
    [
      "one heavy file over the per-file share threshold",
      [
        file("a.ts", { commentChars: 760, codeChars: 150, commentCount: 3, addedLines: 30 }),
        file("b.ts", { codeChars: 3000 }),
      ],
      "report",
    ],
    [
      "heavy file under 300 chars is ignored by the per-file clause",
      [
        file("a.ts", { commentChars: 200, codeChars: 50, commentCount: 3, addedLines: 30 }),
        file("b.ts", { codeChars: 3000 }),
      ],
      "none",
    ],
    ["mostly code", [file("a.ts", { commentChars: 50, codeChars: 1000 })], "none"],
    ["no files", [], "none"],
  ])("%s", (_name, files, tier) => {
    expect(sessionScore(files).tier).toBe(tier);
  });

  test("rollup sums stats and ranks worst files by excess", () => {
    const files = [
      file("small.ts", { commentChars: 100, codeChars: 400, addedLines: 10 }),
      file("big.ts", { commentChars: 900, codeChars: 400, addedLines: 20 }),
      file("clean.ts", { codeChars: 500, addedLines: 5 }),
    ];
    const session = sessionScore(files);
    expect(session.stats.addedLines).toBe(35);
    expect(session.stats.commentChars).toBe(1000);
    expect(session.stats.codeChars).toBe(1300);
    expect(session.share).toBeCloseTo(1000 / 2300, 5);
    expect(session.worstFiles.map((f) => f.path)).toEqual(["big.ts", "small.ts"]);
    expect(session.excessChars).toBeCloseTo(
      session.worstFiles.reduce((sum, f) => sum + f.excessChars, 0),
      5,
    );
  });
});

describe("scoreTranscript", () => {
  const toolUse = (name: string, input: Record<string, unknown>) =>
    JSON.stringify({ message: { content: [{ type: "tool_use", name, input }] } });

  test("accumulates Edit/Write/MultiEdit per file, skipping scratch and unknown paths", async () => {
    const lines = [
      toolUse("Write", {
        file_path: "/repo/a.ts",
        content: ["// adds two numbers", "const x = 1; // trailing", "const y = 2;"].join("\n"),
      }),
      toolUse("Edit", {
        file_path: "/repo/a.ts",
        old_string: "const y = 2;",
        new_string: "const y = 2;\nconst z = 3;",
      }),
      toolUse("MultiEdit", {
        file_path: "/repo/b.py",
        edits: [{ old_string: "", new_string: ["# top comment", "x = 1"].join("\n") }],
      }),
      toolUse("Write", { file_path: "/tmp/skip.ts", content: "// nope\nconst a = 1;" }),
      toolUse("Write", { file_path: "/work/scratchpad/s.ts", content: "const a = 1;" }),
      toolUse("Write", { file_path: "/repo/readme.txt", content: "plain text" }),
      toolUse("Read", { file_path: "/repo/a.ts" }),
      JSON.stringify({ type: "user", message: { content: "not an edit" } }),
      'not json but mentions "tool_use"',
    ];
    const dir = mkdtempSync(join(tmpdir(), "density-"));
    const path = join(dir, "session.jsonl");
    await Bun.write(path, `${lines.join("\n")}\n`);

    const { files, session } = await scoreTranscript(path);
    expect(files.map((f) => ({ path: f.path, language: f.language }))).toEqual([
      { path: "/repo/a.ts", language: "typescript" },
      { path: "/repo/b.py", language: "python" },
    ]);
    expect(files[0]?.stats).toEqual({
      addedLines: 4,
      commentChars: 26,
      codeChars: 27,
      commentLines: 1,
      codeLines: 2,
      mixedLines: 1,
      commentWords: 4,
      commentCount: 2,
      maxCommentChars: 19,
    });
    expect(files[1]?.stats).toEqual({
      addedLines: 2,
      commentChars: 11,
      codeChars: 3,
      commentLines: 1,
      codeLines: 1,
      mixedLines: 0,
      commentWords: 2,
      commentCount: 1,
      maxCommentChars: 13,
    });
    expect(session.stats.addedLines).toBe(6);
    expect(session.tier).toBe("none");
  });
});
