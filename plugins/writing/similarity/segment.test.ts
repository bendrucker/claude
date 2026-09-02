import { describe, expect, test } from "bun:test";
import { fromSentences, segment, splitSentences, stripMarkup } from "./segment";

describe("splitSentences", () => {
  test.each([
    ["Short. Also short.", ["Short.", "Also short."]],
    ["No terminal punctuation", ["No terminal punctuation"]],
    ["It cost 3.5 units total.", ["It cost 3.5 units total."]],
    ["Use e.g. this one. Then stop.", ["Use e.g. this one.", "Then stop."]],
    ["Ask B. Drucker about it.", ["Ask B. Drucker about it."]],
    [
      "Dr. Smith left at 5 p.m. today. We stayed.",
      ["Dr. Smith left at 5 p.m. today.", "We stayed."],
    ],
    ["Really? Yes! Sure.", ["Really?", "Yes!", "Sure."]],
    ["One line\nanother line", ["One line", "another line"]],
    ["   ", []],
  ])("%p", (input, expected) => {
    expect(splitSentences(input).map((sentence) => sentence.text)).toEqual(expected);
  });

  test.each([
    ["Three words here.", 3, 0],
    ["It isn't ours.", 3, 1],
    ["It's fine, isn't it?", 4, 2],
    ["The parser's output was fine.", 5, 0],
    ["Ben's car is here.", 4, 0],
    ["Ben's going home.", 3, 1],
  ])("%p counts %i words and %i contractions", (input, words, contractions) => {
    expect(splitSentences(input)).toEqual([{ text: input, words, contractions }]);
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
  expect(doc.paragraphs.map((paragraph) => paragraph.map((sentence) => sentence.text))).toEqual([
    ["One.", "Two."],
    ["Three here."],
  ]);
  expect(doc.sentences).toHaveLength(3);
});

test("segment keeps contractions as single word tokens", () => {
  expect(segment("It isn't ours.").words).toEqual(["it", "isn't", "ours"]);
});

test("fromSentences treats the run as one paragraph", () => {
  const sentences = splitSentences("A one. B two.");
  const doc = fromSentences(sentences);
  expect(doc.paragraphs).toEqual([sentences]);
  expect(doc.prose).toBe("A one. B two.");
  expect(doc.words).toEqual(["a", "one", "b", "two"]);
});
