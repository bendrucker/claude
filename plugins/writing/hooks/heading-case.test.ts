import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractHeadings, headingCaseViolations } from "./heading-case";

// This file is a byte-for-byte copy of the pull-request plugin's checker. The
// duplication is deliberate: plugins are distributed and installed one at a
// time, so runtime code can only import published npm packages, which rules out
// both a cross-plugin import and a `workspace:*` package. Read as text rather
// than imported, so the plugin-boundary checker still passes.
test("stays identical to the pull-request plugin's copy", async () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const [writing, pullRequest] = await Promise.all([
    Bun.file(join(root, "plugins", "writing", "hooks", "heading-case.ts")).text(),
    Bun.file(join(root, "plugins", "pull-request", "scripts", "heading-case.ts")).text(),
  ]);
  expect(writing).toBe(pullRequest);
});

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
    ["keeps a phrasal-verb particle capitalized", "## Speed Up the Commit Hook", []],
    ["lowercases the short prepositions AP lowercases", "## Cleanup via Worktrunk per Tier", []],
    [
      "capitalizes both halves of a hyphenated compound off the last word",
      "## Follow-up tasks",
      [{ text: "Follow-up tasks", suggested: "Follow-Up Tasks" }],
    ],
    [
      "fixes an acronym-led compound without re-casing the acronym",
      "## CI-outage check",
      [{ text: "CI-outage check", suggested: "CI-Outage Check" }],
    ],
    [
      "leaves an unbackticked CLI flag alone",
      "## Hide the --format flag",
      [{ text: "Hide the --format flag", suggested: "Hide the --format Flag" }],
    ],
    [
      "does not capitalize into a leading numeral",
      "## 3rd-party tooling",
      [{ text: "3rd-party tooling", suggested: "3rd-Party Tooling" }],
    ],
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
