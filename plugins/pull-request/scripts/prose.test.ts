import { describe, expect, it, test } from "bun:test";
import * as fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import { hardWrappedParagraphs, unwrapBody, WRAP_MAX_LINE, WRAP_MIN_LINE } from "./prose";

// Greedy fill at a column: the thing the detector exists to catch. The indent
// keeps a wrapped list item's hanging indent.
function wrapAt(text: string, column: number, indent = ""): string {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > column && current !== "") {
      lines.push(current);
      current = indent + word;
      continue;
    }
    current = candidate;
  }
  lines.push(current);
  return lines.join("\n");
}

// Greedy fill leaves a line longer than column - (MAX_WORD + 1) and never
// longer than column. A list item spends LIST_INDENT of that budget on its
// hanging indent, which the detector measures trimmed and so does not count.
// Deriving the column floor from all three keeps every generated non-final line
// inside [WRAP_MIN_LINE, WRAP_MAX_LINE], so the generator only emits documents
// the detector actually claims to catch.
const MAX_WORD = 9;
const LIST_INDENT = 2;
const MIN_COLUMN = WRAP_MIN_LINE + MAX_WORD + 1 + LIST_INDENT;
const MAX_COLUMN = WRAP_MAX_LINE;

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz".split("");
const word = fc.string({
  minLength: 3,
  maxLength: MAX_WORD,
  unit: fc.constantFrom(...LOWERCASE),
});

/** A block long enough to wrap at any column in range: at least 25 words. */
const block = fc.array(word, { minLength: 25, maxLength: 60 }).map((words) => words.join(" "));

const wrapColumn = fc.integer({ min: MIN_COLUMN, max: MAX_COLUMN });

/** A document of one-line paragraphs and one-line list items. */
const proseDocument = fc
  .array(fc.record({ text: block, bullet: fc.boolean() }), { minLength: 1, maxLength: 4 })
  .map((blocks) => blocks.map(({ text, bullet }) => (bullet ? `- ${text}` : text)).join("\n\n"));

function wrapDocument(doc: string, column: number): string {
  return doc
    .split("\n\n")
    .map((b) =>
      b.startsWith("- ") ? wrapAt(b, column, " ".repeat(LIST_INDENT)) : wrapAt(b, column),
    )
    .join("\n\n");
}

/**
 * What the body renders to. Positions differ after an unwrap by construction,
 * and mdast keeps the newline inside a text node's value, so both are normalized
 * away. What survives is the structure a reader sees.
 */
function renderedShape(body: string): string {
  return JSON.stringify(fromMarkdown(body), (key: string, value: unknown) => {
    if (key === "position") return undefined;
    if (key === "value" && typeof value === "string") return value.replace(/\s+/g, " ");
    return value;
  });
}

describe("hardWrappedParagraphs", () => {
  it("flags a document wrapped at any column in range", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        expect(hardWrappedParagraphs(wrapDocument(doc, column)).length).toBeGreaterThan(0);
      }),
    );
  });

  it("leaves a document alone when every block is on one line", () => {
    fc.assert(
      fc.property(proseDocument, (doc) => {
        expect(hardWrappedParagraphs(doc)).toEqual([]);
      }),
    );
  });

  it("recovers the original document when unwrapping a wrapped one", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        const unwrapped = unwrapBody(wrapDocument(doc, column));
        expect(unwrapped).toBe(doc);
        // Converging in one pass is what makes a single retry clear the deny.
        expect(hardWrappedParagraphs(unwrapped)).toEqual([]);
      }),
    );
  });

  it("never changes what the body renders to", () => {
    fc.assert(
      fc.property(proseDocument, wrapColumn, (doc, column) => {
        const wrapped = wrapDocument(doc, column);
        expect(renderedShape(unwrapBody(wrapped))).toBe(renderedShape(wrapped));
      }),
    );
  });

  const LONG = "The resolver caches every lookup it performs and evicts on a timer";

  // Leading pipes are optional in GFM, so the delimiter row is what marks this
  // as a table. Lazy continuation drops the marker from every quoted line but
  // the first, which puts the answer in the tree rather than in the text.
  const PIPELESS_TABLE =
    "Column heading one here padded out | Column heading two here padded\n---------------------------------- | ---------------------------------\na value in the first column here   | a value in the second column here";
  const QUOTED = `> ${LONG} that\n> ${LONG} runs every thirty seconds here.`;
  const LAZY_QUOTED = `> ${LONG} that\n${LONG} runs every thirty seconds here.`;

  test.each<[string, string, boolean]>([
    ["wrapped paragraph", `${LONG} that\n${LONG} runs every thirty seconds here.`, true],
    ["one-line paragraph", `${LONG} that runs every thirty seconds.`, false],
    ["wrapped list item", `- ${LONG} that\n  ${LONG} runs every thirty seconds here.`, true],
    ["one-line list items", `- ${LONG} once.\n- ${LONG} twice.`, false],
    [
      "table",
      "| Month | Rate | Notes about the month that make the row long |\n|---|---|---|\n| June | 0.5% | The rate was low and stayed low all month |",
      false,
    ],
    ["fenced code", `\`\`\`ts\nconst first = "${LONG}";\nconst second = "${LONG}";\n\`\`\``, false],
    ["two-space hard break", `${LONG} that  \n${LONG} runs every thirty seconds here.`, false],
    [
      "short deliberate lines",
      "Discovery: 8a4c11372239\nDiscovery: 7b7e5d6ca37e\nDiscovery: db1ce0b102e0",
      false,
    ],
    [
      "line past the ceiling",
      `${LONG} and it also does a great many other things besides that one.\n${LONG} here.`,
      false,
    ],
    ["nested list", `- ${LONG} once.\n  - ${LONG} twice.`, false],
    ["pipe-less table with a padded delimiter row", PIPELESS_TABLE, false],
    ["wrapped blockquote", QUOTED, false],
    ["lazily continued blockquote", LAZY_QUOTED, false],
    ["blockquote nested in a list", `- Context:\n  > ${LONG} that\n  > ${LONG} here.`, false],
  ])("%s", (_name, body, expected) => {
    expect(hardWrappedParagraphs(body).length > 0).toBe(expected);
  });

  // Each shape carries markers or column padding that a naive unwrap would
  // splice into the prose, so silence is what keeps the suggested fix
  // trustworthy.
  test.each<[string, string]>([
    ["pipe-less table", PIPELESS_TABLE],
    ["blockquote", QUOTED],
    ["lazily continued blockquote", LAZY_QUOTED],
  ])("leaves a %s byte-identical", (_name, body) => {
    expect(unwrapBody(body)).toBe(body);
  });

  // The join has to absorb the whitespace on both sides of the break, or the
  // correction the hook quotes carries a stray character into the body.
  test.each<[string, string]>([
    ["a CRLF body", `${LONG} that\r\n${LONG} runs every thirty seconds here.`],
    ["a line ending in one space", `${LONG} that \n${LONG} runs every thirty seconds here.`],
  ])("joins %s on a single space", (_name, body) => {
    expect(hardWrappedParagraphs(body)[0]?.unwrapped).toBe(
      `${LONG} that ${LONG} runs every thirty seconds here.`,
    );
  });
});
