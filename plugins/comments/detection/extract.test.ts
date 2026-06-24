import { describe, expect, test } from "bun:test";
import { extractComments, languageForPath } from "./extract";
import type { Language } from "./types";

describe("extractComments python", () => {
  test("line comments, docstring, inline and trailing", async () => {
    const source = [
      "# module-level line comment",
      '"""module docstring"""',
      "def f():",
      '    """function docstring"""',
      "    # inline comment",
      "    return 1  # trailing comment",
    ].join("\n");
    const comments = await extractComments(source, "python");

    expect(comments.map((c) => ({ kind: c.kind, startLine: c.startLine, text: c.text }))).toEqual([
      { kind: "line", startLine: 1, text: "# module-level line comment" },
      { kind: "docstring", startLine: 2, text: '"""module docstring"""' },
      { kind: "docstring", startLine: 4, text: '"""function docstring"""' },
      { kind: "line", startLine: 5, text: "# inline comment" },
      { kind: "line", startLine: 6, text: "# trailing comment" },
    ]);
  });

  test("string literals that are not statement-position docstrings yield no comment", async () => {
    const source = [
      "x = 1",
      'y = "hello # not a comment"',
      "def g():",
      "    z = 1",
      '    "not a docstring because not first statement"',
      "    return z",
    ].join("\n");
    const comments = await extractComments(source, "python");
    expect(comments).toEqual([]);
  });
});

describe("extractComments typescript", () => {
  test("line, block, and jsdoc docstring kinds", async () => {
    const source = [
      "// line comment",
      "/* block comment */",
      "/** jsdoc docstring */",
      "const x = 1;",
    ].join("\n");
    const comments = await extractComments(source, "typescript");
    expect(comments.map((c) => ({ kind: c.kind, startLine: c.startLine }))).toEqual([
      { kind: "line", startLine: 1 },
      { kind: "block", startLine: 2 },
      { kind: "docstring", startLine: 3 },
    ]);
  });

  test("multi-line block comment spans startLine < endLine", async () => {
    const source = ["const x = 1;", "/*", " block", " body", "*/", "const y = 2;"].join("\n");
    const comments = await extractComments(source, "typescript");
    expect(comments).toHaveLength(1);
    const block = comments[0];
    if (block == null) throw new Error("expected one comment");
    expect(block.kind).toBe("block");
    expect(block.startLine).toBe(2);
    expect(block.endLine).toBe(5);
    expect(block.startLine).toBeLessThan(block.endLine);
  });
});

describe("extractComments go", () => {
  test("line and block comments", async () => {
    const source = [
      "package main",
      "// line comment",
      "/* block comment */",
      "func main() {}",
    ].join("\n");
    const comments = await extractComments(source, "go");
    expect(comments.map((c) => ({ kind: c.kind, startLine: c.startLine }))).toEqual([
      { kind: "line", startLine: 2 },
      { kind: "block", startLine: 3 },
    ]);
  });
});

describe("extractComments rust", () => {
  test("line and block comments", async () => {
    const source = ["// line comment", "/* block comment */", "fn main() {}"].join("\n");
    const comments = await extractComments(source, "rust");
    expect(comments.map((c) => ({ kind: c.kind, startLine: c.startLine }))).toEqual([
      { kind: "line", startLine: 1 },
      { kind: "block", startLine: 2 },
    ]);
  });
});

describe("extractComments bash", () => {
  test("shebang and line comment are both line-kind comment nodes", async () => {
    const source = ["#!/usr/bin/env bash", "# a comment", "echo hi # trailing"].join("\n");
    const comments = await extractComments(source, "bash");
    expect(comments).toEqual([
      {
        kind: "line",
        text: "#!/usr/bin/env bash",
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 19,
      },
      {
        kind: "line",
        text: "# a comment",
        startLine: 2,
        endLine: 2,
        startColumn: 0,
        endColumn: 11,
      },
      { kind: "line", text: "# trailing", startLine: 3, endLine: 3, startColumn: 8, endColumn: 18 },
    ]);
  });
});

describe("languageForPath", () => {
  test.each<[string, Language]>([
    ["a.py", "python"],
    ["a.ts", "typescript"],
    ["a.tsx", "tsx"],
    ["a.js", "javascript"],
    ["a.jsx", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.go", "go"],
    ["a.rs", "rust"],
    ["a.sh", "bash"],
    ["a.bash", "bash"],
    ["dir/sub/file.TS", "typescript"],
  ])("%s maps to %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  test.each(["a.txt", "README", "a.rb", "Makefile"])("%s is unknown", (path) => {
    expect(languageForPath(path)).toBeNull();
  });
});
