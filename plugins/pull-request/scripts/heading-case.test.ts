import { describe, expect, test } from "bun:test";
import { extractHeadings, headingCaseViolations } from "./heading-case";

describe("headingCaseViolations", () => {
  test.each<[string, string, { text: string; suggested: string }[]]>([
    [
      "flags a sentence-case heading",
      "## Two fixes found while testing",
      [{ text: "Two fixes found while testing", suggested: "Two Fixes Found While Testing" }],
    ],
    [
      "flags over-capitalized stopwords",
      "## Changes To The Parser",
      [{ text: "Changes To The Parser", suggested: "Changes to the Parser" }],
    ],
    ["ignores an already AP-cased heading", "## Changes to the Parser", []],
    ["preserves an all-caps acronym", "## API Changes", []],
    ["preserves a mixed-case identifier", "## gitLab Integration", []],
    ["excludes an inline-code word", "## Changes to `validate.ts`", []],
    ["ignores a heading that is only code", "## `foo.ts`", []],
  ])("%s", (_name, body, expected) => {
    expect(headingCaseViolations(body)).toEqual(expected);
  });

  test("flags each heading in a multi-heading body", () => {
    const body = "## Two fixes found\n\nSome prose.\n\n## Changes To The Parser";
    expect(headingCaseViolations(body)).toEqual([
      { text: "Two fixes found", suggested: "Two Fixes Found" },
      { text: "Changes To The Parser", suggested: "Changes to the Parser" },
    ]);
  });

  test("suggests re-casing around a preserved inline-code word", () => {
    expect(headingCaseViolations("## changes to `validate.ts`")).toEqual([
      { text: "changes to `validate.ts`", suggested: "Changes to `validate.ts`" },
    ]);
  });

  test("ignores a `#` line inside a fenced code block", () => {
    const body = "Prose about the change.\n\n```md\n## two words lower\n```";
    expect(headingCaseViolations(body)).toEqual([]);
  });
});

describe("extractHeadings", () => {
  test("reconstructs heading text and keeps inline code", () => {
    const headings = extractHeadings("## Changes to `validate.ts`\n\n### Plain Heading");
    expect(headings.map((heading) => heading.text)).toEqual([
      "Changes to `validate.ts`",
      "Plain Heading",
    ]);
  });

  test("skips a `#` line inside a fenced code block", () => {
    expect(extractHeadings("```\n## fake\n```")).toEqual([]);
  });
});
