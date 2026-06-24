import { describe, expect, test } from "bun:test";
import { extractComments, languageForPath } from "./extract";
import { extractSqlComments } from "./sql";

const texts = (source: string) => extractSqlComments(source).map((c) => c.text);

describe("extractSqlComments", () => {
  test.each([
    ["line comment", "SELECT 1; -- trailing", ["-- trailing"]],
    ["line comment to end of line", "-- head\nSELECT 1;", ["-- head"]],
    ["block comment", "SELECT /* inline */ 1;", ["/* inline */"]],
    ["multiple comments", "-- a\nSELECT 1; -- b\n/* c */", ["-- a", "-- b", "/* c */"]],
    ["dash inside string", "SELECT '-- not a comment';", []],
    ["slash-star inside string", "SELECT '/* not a comment */';", []],
    ["doubled quote escapes the close", "SELECT 'it''s -- fine'; -- real", ["-- real"]],
    ["dash inside quoted identifier", 'SELECT "weird--col" FROM t; -- real', ["-- real"]],
    ["dollar-quoted string", "SELECT $$ -- nope /* nope */ $$; -- real", ["-- real"]],
    ["tagged dollar-quoted string", "SELECT $t$ -- nope $t$; -- real", ["-- real"]],
    ["COMMENT keyword is not a comment", "COMMENT ON TABLE t IS 'note';", []],
    ["unterminated block runs to EOF", "SELECT 1;\n/* oops", ["/* oops"]],
    ["unterminated string runs to EOF", "SELECT 'oops -- /*", []],
  ])("%s", (_name, source, expected) => {
    expect(texts(source)).toEqual(expected);
  });

  test("reports 1-based lines, 0-based columns, exclusive end", () => {
    expect(extractSqlComments("SELECT 1; -- tail")).toEqual([
      { kind: "line", text: "-- tail", startLine: 1, endLine: 1, startColumn: 10, endColumn: 17 },
    ]);
  });

  test("a block comment spans multiple lines", () => {
    expect(extractSqlComments("/* a\nbb */\nSELECT 1;")).toEqual([
      {
        kind: "block",
        text: "/* a\nbb */",
        startLine: 1,
        endLine: 2,
        startColumn: 0,
        endColumn: 5,
      },
    ]);
  });

  test("a multi-line string keeps a later comment's line number correct", () => {
    const comments = extractSqlComments("SELECT $$\nmulti\nline$$;\n-- real");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.startLine).toBe(4);
  });
});

describe("sql routing", () => {
  test("languageForPath maps .sql", () => {
    expect(languageForPath("migrations/001_init.sql")).toBe("sql");
  });

  test("extractComments routes sql to the scanner", async () => {
    expect(await extractComments("SELECT '/* x */'; -- real", "sql")).toEqual([
      { kind: "line", text: "-- real", startLine: 1, endLine: 1, startColumn: 18, endColumn: 25 },
    ]);
  });
});
