import { describe, expect, test } from "bun:test";
import { fromSentences, segment, sentenceWordCount, splitSentences, stripMarkup } from "./segment";

describe("splitSentences", () => {
  test.each([
    ["Short. Also short.", ["Short.", "Also short."]],
    ["No terminal punctuation", ["No terminal punctuation"]],
    ["Wait... ok then.", ["Wait...", "ok then."]],
    ["It cost 3.5 units total.", ["It cost 3.5 units total."]],
    ["Use e.g. this one. Then stop.", ["Use e.g. this one.", "Then stop."]],
    ["Ask B. Drucker about it.", ["Ask B. Drucker about it."]],
    [
      "Section 3 covers topic A. The next covers B.",
      ["Section 3 covers topic A.", "The next covers B."],
    ],
    ["Really? Yes! Sure.", ["Really?", "Yes!", "Sure."]],
    ["   ", []],
  ])("%p", (input, expected) => {
    expect(splitSentences(input)).toEqual(expected);
  });
});

describe("stripMarkup", () => {
  test.each([
    ["fenced code", "before\n```\nconst x = 1;\n```\nafter", ["before", "after"], ["const x"]],
    ["inline code", "call `doThing()` now.", ["call", "now."], ["doThing"]],
    ["link text kept", "see [the docs](https://example.com) here", ["the docs"], ["example.com"]],
    ["bare url", "at https://example.com/x now", ["at", "now"], ["example.com"]],
    ["heading marker", "## A Heading\nbody", ["A Heading", "body"], ["##"]],
    ["list marker", "- first item\n- second item", ["first item"], ["- first"]],
    ["table row", "| a | b |\ntext", ["text"], ["| a |"]],
    ["blockquote", "> quoted line", ["quoted line"], ["> quoted"]],
  ])("%s", (_name, input, present, absent) => {
    const stripped = stripMarkup(input);
    for (const fragment of present) expect(stripped).toContain(fragment);
    for (const fragment of absent) expect(stripped).not.toContain(fragment);
  });
});

test("segment groups sentences into blank-line paragraphs", () => {
  const doc = segment("One. Two.\n\nThree here.");
  expect(doc.paragraphs).toEqual([["One.", "Two."], ["Three here."]]);
  expect(doc.sentences).toHaveLength(3);
});

test("segment keeps contractions as single word tokens", () => {
  expect(segment("It isn't ours.").words).toEqual(["it", "isn't", "ours"]);
});

test("fromSentences treats the run as one paragraph", () => {
  const doc = fromSentences(["A one.", "B two."]);
  expect(doc.paragraphs).toEqual([["A one.", "B two."]]);
  expect(doc.prose).toBe("A one. B two.");
});

test.each([
  ["Three words here.", 3],
  ["It isn't ours.", 3],
  ["", 0],
])("sentenceWordCount(%p)", (input, expected) => {
  expect(sentenceWordCount(input)).toBe(expected);
});
