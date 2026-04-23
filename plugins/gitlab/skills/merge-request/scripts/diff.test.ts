import { describe, expect, it } from "bun:test";
import {
  buildPosition,
  isLineInDiff,
  parseDiffHunks,
  parseGlabPaginated,
  validateLineInDiff,
} from "./diff";

describe("parseGlabPaginated", () => {
  it("parses a single page", () => {
    const result = parseGlabPaginated('[{"id": 1}]');
    expect(result).toEqual([{ id: 1 }]);
  });

  it("fixes concatenated pages", () => {
    const result = parseGlabPaginated('[{"id": 1}][{"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles whitespace between pages", () => {
    const result = parseGlabPaginated('[{"id": 1}]\n[{"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles three concatenated pages", () => {
    const result = parseGlabPaginated('[{"a":1}][{"b":2}][{"c":3}]');
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("preserves arrays inside objects", () => {
    const result = parseGlabPaginated('[{"notes": [1, 2]}]');
    expect(result).toEqual([{ notes: [1, 2] }]);
  });
});

describe("parseDiffHunks", () => {
  it("parses a single hunk", () => {
    const diff = "@@ -10,5 +12,8 @@ function foo() {";
    expect(parseDiffHunks(diff)).toEqual([
      { oldStart: 10, oldCount: 5, newStart: 12, newCount: 8 },
    ]);
  });

  it("parses multiple hunks", () => {
    const diff = [
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added",
      " line2",
      "@@ -20,5 +21,6 @@ context",
      " line20",
    ].join("\n");
    expect(parseDiffHunks(diff)).toEqual([
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 },
      { oldStart: 20, oldCount: 5, newStart: 21, newCount: 6 },
    ]);
  });

  it("handles single-line hunks (no count)", () => {
    const diff = "@@ -5 +5 @@";
    expect(parseDiffHunks(diff)).toEqual([{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 }]);
  });

  it("handles deletion-only hunks", () => {
    const diff = "@@ -10,3 +9,0 @@";
    expect(parseDiffHunks(diff)).toEqual([{ oldStart: 10, oldCount: 3, newStart: 9, newCount: 0 }]);
  });

  it("returns empty for binary files", () => {
    expect(parseDiffHunks("Binary files differ")).toEqual([]);
  });
});

describe("isLineInDiff", () => {
  const hunks = [
    { oldStart: 10, oldCount: 5, newStart: 12, newCount: 8 },
    { oldStart: 30, oldCount: 3, newStart: 35, newCount: 4 },
  ];

  it("returns true for line at hunk start", () => {
    expect(isLineInDiff(hunks, 12, "new")).toBe(true);
  });

  it("returns true for line at hunk end", () => {
    expect(isLineInDiff(hunks, 19, "new")).toBe(true);
  });

  it("returns true for line in middle of hunk", () => {
    expect(isLineInDiff(hunks, 15, "new")).toBe(true);
  });

  it("returns false for line outside hunks", () => {
    expect(isLineInDiff(hunks, 25, "new")).toBe(false);
  });

  it("returns false for line between hunks", () => {
    expect(isLineInDiff(hunks, 22, "new")).toBe(false);
  });

  it("checks old side correctly", () => {
    expect(isLineInDiff(hunks, 10, "old")).toBe(true);
    expect(isLineInDiff(hunks, 14, "old")).toBe(true);
    expect(isLineInDiff(hunks, 15, "old")).toBe(false);
  });

  it("works with second hunk", () => {
    expect(isLineInDiff(hunks, 35, "new")).toBe(true);
    expect(isLineInDiff(hunks, 38, "new")).toBe(true);
    expect(isLineInDiff(hunks, 39, "new")).toBe(false);
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

  it("builds position with new line", () => {
    const pos = buildPosition(refs, "src/app.ts", { line: 42 });
    expect(pos).toEqual({
      base_sha: "aaa",
      head_sha: "bbb",
      start_sha: "ccc",
      old_path: "src/app.ts",
      new_path: "src/app.ts",
      position_type: "text",
      new_line: 42,
    });
  });

  it("builds position with old line", () => {
    const pos = buildPosition(refs, "src/app.ts", { oldLine: 10 });
    expect(pos).toEqual({
      base_sha: "aaa",
      head_sha: "bbb",
      start_sha: "ccc",
      old_path: "src/app.ts",
      new_path: "src/app.ts",
      position_type: "text",
      old_line: 10,
    });
  });

  it("builds position without line (general file comment)", () => {
    const pos = buildPosition(refs, "src/app.ts", {});
    expect(pos).toEqual({
      base_sha: "aaa",
      head_sha: "bbb",
      start_sha: "ccc",
      old_path: "src/app.ts",
      new_path: "src/app.ts",
      position_type: "text",
    });
  });
});
