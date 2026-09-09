import { describe, expect, test } from "bun:test";
import { correctHeadingCase, extractHeadings, headingCaseViolations } from "./heading-case";

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
    ["leaves an unbackticked filename alone", "## Page Column Rule in global.css", []],
    ["leaves unbackticked config names alone", "## Notes on package.json and bun.lock", []],
    ["leaves a dotted name in a deeper heading alone", "### Rows From views.sql", []],
    [
      "re-cases around an unbackticked filename",
      "## What sourcing tmux.conf actually does",
      [
        {
          text: "What sourcing tmux.conf actually does",
          suggested: "What Sourcing tmux.conf Actually Does",
        },
      ],
    ],
    [
      "re-cases around several unbackticked filenames",
      "## sections.md and tsconfig.json both moved",
      [
        {
          text: "sections.md and tsconfig.json both moved",
          suggested: "sections.md and tsconfig.json Both Moved",
        },
      ],
    ],
    [
      "still flags a sentence-case heading that ends in a period",
      "## Two fixes found while testing.",
      [{ text: "Two fixes found while testing.", suggested: "Two Fixes Found While Testing." }],
    ],
    [
      "still lowercases the `vs.` stopword",
      "## Rebase Vs. Merge",
      [{ text: "Rebase Vs. Merge", suggested: "Rebase vs. Merge" }],
    ],
    [
      "leaves a hyphenated filename whole rather than casing each segment",
      "## Fix the ci-config.json path",
      [{ text: "Fix the ci-config.json path", suggested: "Fix the ci-config.json Path" }],
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

describe("correctHeadingCase", () => {
  test.each<[string, string]>([
    ["sentence-case heading", "## Two fixes found while testing"],
    ["over-capitalized stopwords", "## Changes To The Parser"],
    ["hyphenated compound", "## Follow-up tasks"],
    ["inline code in the heading", "## Changes to `validate.ts` and the parser"],
    ["closing hash sequence", "## Two fixes found while testing ##"],
    ["deeper level under prose", "Intro.\n\n#### Known limitation\n\nDetail."],
    ["several headings at once", "## Null floor\n\nText.\n\n### Corpus results\n\nMore."],
    [
      "heading beside a fence holding a hash line",
      "## Latch placement\n\n```sh\n# not a heading\n```\n",
    ],
  ])("rewrites a %s", (_name, body) => {
    const fix = correctHeadingCase(body);
    expect(fix.skipped).toEqual([]);
    expect(fix.applied.length).toBeGreaterThan(0);
    expect(fix.body).toMatchSnapshot();
    expect(headingCaseViolations(fix.body)).toEqual([]);
    expect(correctHeadingCase(fix.body).body).toBe(fix.body);
  });

  test.each<[string, string]>([
    ["already AP-cased headings", "## Changes to the Parser\n\nText.\n\n### API Notes"],
    ["a hash line inside a fence", "Text.\n\n```md\n## two words lower\n```\n"],
    ["an indented code block", "Text.\n\n    ## two words lower\n"],
    ["a body with no headings", "Adds an LRU cache to the resolver.\n"],
  ])("leaves %s untouched", (_name, body) => {
    expect(correctHeadingCase(body)).toEqual({ body, applied: [], skipped: [] });
  });

  test.each<[string, string]>([
    ["emphasis", "## **Two fixes** found while testing"],
    ["a link", "## Two fixes found in [the resolver](https://example.com)"],
    ["a setext underline", "Two fixes found while testing\n===\n"],
  ])("reports a heading carrying %s as skipped", (_name, body) => {
    const fix = correctHeadingCase(body);
    expect(fix.body).toBe(body);
    expect(fix.applied).toEqual([]);
    expect(fix.skipped).toEqual(headingCaseViolations(body));
  });

  test.each<[string, string, string]>([
    ["a double space between words", "##  Two  fixes found", "##  Two  Fixes Found"],
    ["a tab between words", "## Two\tfixes found", "## Two\tFixes Found"],
    ["padding before a closing hash run", "## Two  fixes found  ##", "## Two  Fixes Found  ##"],
  ])("keeps %s as written", (_name, body, expected) => {
    const fix = correctHeadingCase(body);
    expect(fix.body).toBe(expected);
    expect(fix.skipped).toEqual([]);
    expect(headingCaseViolations(fix.body)).toEqual([]);
  });

  test("touches only the heading line", () => {
    const body = "Intro prose stays as written.\n\n## Null floor\n\nProse below, also unchanged.\n";
    expect(correctHeadingCase(body).body).toBe(
      "Intro prose stays as written.\n\n## Null Floor\n\nProse below, also unchanged.\n",
    );
  });
});
