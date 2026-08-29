import { expect, test } from "bun:test";
import { flaggedHeadings, gradeHeadings } from "./assert-headings";

function draft(body: string): { title: string; body: string } {
  return { title: "Add the heading assert", body };
}

test.each<{ name: string; body: string; flagged: string[] }>([
  { name: "no headings at all", body: "One paragraph, no sections.\n", flagged: [] },
  {
    name: "title-case noun labels",
    body: "## Background\n\nText.\n\n### Rate Limit Cache\n\nText.\n",
    flagged: [],
  },
  {
    name: "a code-heavy label",
    body: "## `--format json` and `scripts/mine.ts`\n\nText.\n",
    flagged: [],
  },
  {
    name: "a sentence-case heading",
    body: "## Headless fallback\n\nText.\n",
    flagged: ["Headless fallback"],
  },
  {
    name: "an interrogative opener",
    body: "## Why This Happens\n\nText.\n\n## Notes\n\nText.\n",
    flagged: ["Why This Happens"],
  },
  {
    name: "emphasis around a sentence heading",
    body: "## *Why This Happens*\n\nText.\n",
    flagged: ["Why This Happens"],
  },
  {
    name: "a heading inside a fence",
    body: "## Notes\n\n```md\n## Why This Happens\n```\n",
    flagged: [],
  },
])("flaggedHeadings on $name", ({ body, flagged }) => {
  expect(flaggedHeadings(body).map((heading) => heading.text)).toEqual(flagged);
});

test("a clean draft passes and counts the headings it read", () => {
  expect(gradeHeadings(draft("## Background\n\nText.\n\n## Verification\n\nText.\n")))
    .toMatchInlineSnapshot(`
    {
      "pass": true,
      "reason": "2 headings, none flagged.",
      "score": 1,
    }
  `);
});

test("a flagged draft fails and names every tell", () => {
  expect(gradeHeadings(draft("## Why This Happens\n\nText.\n\n## Headless fallback\n\nText.\n")))
    .toMatchInlineSnapshot(`
    {
      "pass": false,
      "reason": 
    "2 of 2 headings read as sentences:
      "Why This Happens" · interrogative opener "why"; predicate verb "happens"; sentence subject pronoun
      "Headless fallback" · sentence case (1 lowercase content words)"
    ,
      "score": 0,
    }
  `);
});

test("a draft arriving as JSON text grades the same as the parsed object", () => {
  const body = "## Headless fallback\n\nText.\n";
  expect(gradeHeadings(JSON.stringify(draft(body)))).toEqual(gradeHeadings(draft(body)));
});

test.each<{ name: string; output: unknown }>([
  { name: "a bare string", output: "## Background\n\nText.\n" },
  { name: "an object missing body", output: { title: "Only a title" } },
  { name: "null", output: null },
])("gradeHeadings rejects $name", ({ output }) => {
  expect(gradeHeadings(output)).toEqual({
    pass: false,
    score: 0,
    reason: "Output is not a { title, body } draft.",
  });
});
