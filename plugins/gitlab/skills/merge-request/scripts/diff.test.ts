import { describe, expect, it, test } from "bun:test";
import {
  buildPosition,
  type Hunk,
  isLineInDiff,
  parseDiffHunks,
  parseGlabPaginated,
  validateLineInDiff,
} from "./diff";

describe("parseGlabPaginated", () => {
  test.each<{ name: string; raw: string; expected: unknown[] }>([
    { name: "parses a single page", raw: '[{"id": 1}]', expected: [{ id: 1 }] },
    {
      name: "fixes concatenated pages",
      raw: '[{"id": 1}][{"id": 2}]',
      expected: [{ id: 1 }, { id: 2 }],
    },
    {
      name: "handles whitespace between pages",
      raw: '[{"id": 1}]\n[{"id": 2}]',
      expected: [{ id: 1 }, { id: 2 }],
    },
    {
      name: "handles three concatenated pages",
      raw: '[{"a":1}][{"b":2}][{"c":3}]',
      expected: [{ a: 1 }, { b: 2 }, { c: 3 }],
    },
    {
      name: "preserves arrays inside objects",
      raw: '[{"notes": [1, 2]}]',
      expected: [{ notes: [1, 2] }],
    },
  ])("$name", ({ raw, expected }) => {
    expect(parseGlabPaginated(raw)).toEqual(expected);
  });
});

describe("parseDiffHunks", () => {
  test.each<{ name: string; diff: string; expected: Hunk[] }>([
    {
      name: "parses a single hunk",
      diff: "@@ -10,5 +12,8 @@ function foo() {",
      expected: [{ oldStart: 10, oldCount: 5, newStart: 12, newCount: 8 }],
    },
    {
      name: "parses multiple hunks",
      diff: [
        "@@ -1,3 +1,4 @@",
        " line1",
        "+added",
        " line2",
        "@@ -20,5 +21,6 @@ context",
        " line20",
      ].join("\n"),
      expected: [
        { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 },
        { oldStart: 20, oldCount: 5, newStart: 21, newCount: 6 },
      ],
    },
    {
      name: "handles single-line hunks (no count)",
      diff: "@@ -5 +5 @@",
      expected: [{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 }],
    },
    {
      name: "handles deletion-only hunks",
      diff: "@@ -10,3 +9,0 @@",
      expected: [{ oldStart: 10, oldCount: 3, newStart: 9, newCount: 0 }],
    },
    { name: "returns empty for binary files", diff: "Binary files differ", expected: [] },
  ])("$name", ({ diff, expected }) => {
    expect(parseDiffHunks(diff)).toEqual(expected);
  });
});

describe("isLineInDiff", () => {
  const hunks = [
    { oldStart: 10, oldCount: 5, newStart: 12, newCount: 8 },
    { oldStart: 30, oldCount: 3, newStart: 35, newCount: 4 },
  ];

  test.each<{ name: string; line: number; side: "new" | "old"; expected: boolean }>([
    { name: "returns true for line at hunk start", line: 12, side: "new", expected: true },
    { name: "returns true for line at hunk end", line: 19, side: "new", expected: true },
    { name: "returns true for line in middle of hunk", line: 15, side: "new", expected: true },
    { name: "returns false for line outside hunks", line: 25, side: "new", expected: false },
    { name: "returns false for line between hunks", line: 22, side: "new", expected: false },
    { name: "checks old side correctly (start)", line: 10, side: "old", expected: true },
    { name: "checks old side correctly (end)", line: 14, side: "old", expected: true },
    { name: "checks old side correctly (past end)", line: 15, side: "old", expected: false },
    { name: "works with second hunk (start)", line: 35, side: "new", expected: true },
    { name: "works with second hunk (end)", line: 38, side: "new", expected: true },
    { name: "works with second hunk (past end)", line: 39, side: "new", expected: false },
  ])("$name", ({ line, side, expected }) => {
    expect(isLineInDiff(hunks, line, side)).toBe(expected);
  });
});

describe("validateLineInDiff", () => {
  const diffs = [
    {
      old_path: "src/app.ts",
      new_path: "src/app.ts",
      diff: "@@ -10,5 +12,8 @@\n context\n+added\n",
    },
  ];

  it("passes for valid new line", () => {
    expect(() => validateLineInDiff(diffs, "src/app.ts", { line: 15 })).not.toThrow();
  });

  it("passes for valid old line", () => {
    expect(() => validateLineInDiff(diffs, "src/app.ts", { oldLine: 12 })).not.toThrow();
  });

  it("throws for line outside diff", () => {
    expect(() => validateLineInDiff(diffs, "src/app.ts", { line: 50 })).toThrow(
      "not within a diff hunk",
    );
  });

  it("throws for unknown file", () => {
    expect(() => validateLineInDiff(diffs, "unknown.ts", { line: 1 })).toThrow(
      "not found in MR diff",
    );
  });
});

describe("buildPosition", () => {
  const refs = { base_sha: "aaa", head_sha: "bbb", start_sha: "ccc" };
  const base = {
    base_sha: "aaa",
    head_sha: "bbb",
    start_sha: "ccc",
    old_path: "src/app.ts",
    new_path: "src/app.ts",
    position_type: "text" as const,
  };

  test.each<{
    name: string;
    lineArg: { line?: number; oldLine?: number };
    extra: Record<string, number>;
  }>([
    { name: "builds position with new line", lineArg: { line: 42 }, extra: { new_line: 42 } },
    {
      name: "builds position with old line",
      lineArg: { oldLine: 10 },
      extra: { old_line: 10 },
    },
    {
      name: "builds position without line (general file comment)",
      lineArg: {},
      extra: {},
    },
  ])("$name", ({ lineArg, extra }) => {
    const pos = buildPosition(refs, "src/app.ts", lineArg);
    expect(pos).toEqual({ ...base, ...extra });
  });
});
