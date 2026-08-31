import { describe, expect, test } from "bun:test";
import { extractComments, languageForPath } from "./extract";

/** Comments reduced to the fields each assertion below cares about. */
const summarize = async (source: string, language: string) =>
  (await extractComments(source, language)).map((c) => ({ kind: c.kind, text: c.text }));

describe("extractComments: python", () => {
  test("line, trailing, and module/function docstrings", async () => {
    const source = [
      "# header",
      '"""module"""',
      "def f():",
      '    """fn doc"""',
      "    return 1  # trail",
    ].join("\n");
    expect(await summarize(source, "python")).toEqual([
      { kind: "line", text: "# header" },
      { kind: "docstring", text: '"""module"""' },
      { kind: "docstring", text: '"""fn doc"""' },
      { kind: "line", text: "# trail" },
    ]);
  });

  test.each([
    ["an assigned triple-quoted string", 'x = """not a docstring"""'],
    [
      "a bare string that is not the first statement",
      ["def g():", "    z = 1", '    "later"'].join("\n"),
    ],
  ])("yields no comment for %s", async (_name, source) => {
    expect(await extractComments(source, "python")).toEqual([]);
  });
});

describe("extractComments: rust", () => {
  test("line, doc comment, and string-safety", async () => {
    const source = ["// line", "/// doc", 'let s = "// nope";'].join("\n");
    expect(await summarize(source, "rust")).toEqual([
      { kind: "line", text: "// line" },
      { kind: "docstring", text: "/// doc" },
    ]);
  });

  test("coalesces a multi-line block into one comment", async () => {
    const source = ["/* block", " spans", " lines */"].join("\n");
    const comments = await extractComments(source, "rust");
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      kind: "block",
      text: "/* block\n spans\n lines */",
      startLine: 1,
      endLine: 3,
    });
  });

  test("keeps two adjacent single-line blocks separate", async () => {
    expect(await summarize(["/* a */", "/* b */"].join("\n"), "rust")).toEqual([
      { kind: "block", text: "/* a */" },
      { kind: "block", text: "/* b */" },
    ]);
  });
});

describe("extractComments: typescript", () => {
  test("line, block, jsdoc, and string-safety", async () => {
    const source = ["// line", "/* block */", "/** jsdoc */", 'const s = "// nope";'].join("\n");
    expect(await summarize(source, "typescript")).toEqual([
      { kind: "line", text: "// line" },
      { kind: "block", text: "/* block */" },
      { kind: "docstring", text: "/** jsdoc */" },
    ]);
  });

  test("keeps two same-line comments separate without swallowing the code between", async () => {
    expect(await summarize("const x = 1; /* a */ const y = 2; // b", "typescript")).toEqual([
      { kind: "block", text: "/* a */" },
      { kind: "line", text: "// b" },
    ]);
  });

  test("coalesces a block across a blank interior line", async () => {
    const comments = await extractComments(["/*", "foo", "", "bar", "*/"].join("\n"), "typescript");
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      kind: "block",
      startLine: 1,
      endLine: 5,
      text: "/*\nfoo\n\nbar\n*/",
    });
  });
});

describe("extractComments: sql", () => {
  test("extracts -- and /* */ comments", async () => {
    const source = ["-- line", "SELECT 1; /* block", " more */"].join("\n");
    expect(await summarize(source, "sql")).toEqual([
      { kind: "line", text: "-- line" },
      { kind: "block", text: "/* block\n more */" },
    ]);
  });
});

describe("extractComments: line-run coalescing", () => {
  test("coalesces a run of same-column line comments into one", async () => {
    const source = ["-- first line", "-- second line", "-- third line"].join("\n");
    const comments = await extractComments(source, "sql");
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      kind: "line",
      text: "-- first line\n-- second line\n-- third line",
      startLine: 1,
      endLine: 3,
    });
  });

  test("a blank line ends the run", async () => {
    expect(await summarize(["// a", "// b", "", "// c"].join("\n"), "typescript")).toEqual([
      { kind: "line", text: "// a\n// b" },
      { kind: "line", text: "// c" },
    ]);
  });

  test("a column change ends the run", async () => {
    const source = ["// top", "  // indented"].join("\n");
    expect(await summarize(source, "typescript")).toEqual([
      { kind: "line", text: "// top" },
      { kind: "line", text: "// indented" },
    ]);
  });

  test("a line comment does not merge into a following block comment", async () => {
    expect(await summarize(["// line", "/* block */"].join("\n"), "typescript")).toEqual([
      { kind: "line", text: "// line" },
      { kind: "block", text: "/* block */" },
    ]);
  });
});

describe("extractComments: cpp has no vendored grammar", () => {
  test("returns // and /* */ but not preprocessor directives", async () => {
    const source = [
      "#include <stdio.h>",
      "#define X 1",
      "// line",
      "/* block */",
      "int main() { return 0; }",
    ].join("\n");
    expect(await summarize(source, "cpp")).toEqual([
      { kind: "line", text: "// line" },
      { kind: "block", text: "/* block */" },
    ]);
  });

  test("a trailing comment's text and startColumn begin at the delimiter", async () => {
    // The C grammar folds the space before a trailing comment into its token.
    expect(await extractComments("int y = 1; /* a */", "cpp")).toEqual([
      { kind: "block", text: "/* a */", startLine: 1, endLine: 1, startColumn: 11, endColumn: 18 },
    ]);
  });
});

describe("extractComments: config languages", () => {
  test("TOML line comments", async () => {
    const source = ["# top comment", 'name = "x" # trailing'].join("\n");
    expect(await summarize(source, "toml")).toEqual([
      { kind: "line", text: "# top comment" },
      { kind: "line", text: "# trailing" },
    ]);
  });

  test("YAML line comments", async () => {
    const source = ["# top comment", "key: value # trailing"].join("\n");
    expect(await summarize(source, "yaml")).toEqual([
      { kind: "line", text: "# top comment" },
      { kind: "line", text: "# trailing" },
    ]);
  });
});

describe("languageForPath", () => {
  test.each([
    ["a.py", "python"],
    ["a.ts", "typescript"],
    ["a.rs", "rust"],
    ["a.sql", "sql"],
    ["a.cpp", "cpp"],
    ["a.rb", "ruby"],
    ["a.toml", "toml"],
    ["a.yaml", "yaml"],
    ["a.yml", "yaml"],
    ["a.vue", "vue"],
    ["a.svelte", "svelte"],
    ["a.tf", "terraform"],
    ["a.hcl", "hcl"],
    ["a.lua", "lua"],
    ["a.swift", "swift"],
    ["a.php", "php"],
    ["a.cs", "csharp"],
    ["a.dart", "dart"],
    ["a.zig", "zig"],
    ["a.ex", "elixir"],
    ["a.exs", "elixir"],
    ["a.fish", "fish"],
    ["a.ps1", "powershell"],
    ["a.scala", "scala"],
    ["a.zsh", "shellscript"],
    ["Makefile", null],
    ["a.unknownext", null],
  ])("%s -> %s", (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });
});
