import { describe, expect, test } from "bun:test";
import { measureStructure as measureForEval } from "../evals/pr-body/structure";
import { exceededLimits, measureStructure, type Structure } from "./structure";

const FENCE = "```";

const BODIES: Record<string, string> = {
  empty: "",
  "one paragraph": "Adds an LRU cache to the resolver. Reads fall back to the database.",
  "headings and prose": "## Summary\n\nFixes a bug in `parse`.\n\n## Testing\n\nRan it by hand.",
  "nested list": "- one two three\n  - four `five` six\n- seven\n\n1. eight nine",
  "task list": "- [x] done `a`\n- [ ] pending `b` `c`",
  table: "| a | b |\n| - | - |\n| one two three | four five six |\n\nAfter the table.",
  "fenced output": `Before.\n\n${FENCE}\nlots of words in fenced output here\n${FENCE}\n\nAfter.`,
  "details block":
    "Before.\n\n<details>\n<summary>Log</summary>\n\nHidden `code` words here.\n\n</details>\n\nAfter.",
  "glued details":
    "Before.\n\n<details><summary>Log</summary>Hidden words here.</details>\n\nAfter.",
  "nested details":
    "<details>\n\n<details>\n\ninner words\n\n</details>\n\nouter words\n\n</details>\n\nVisible.",
  blockquote: "> quoted words here with `code`\n\nPlain.",
  "inline code in heading": "## The `cache` layer\n\nBody words.",
  "list item with code block": `- item words\n\n  ${FENCE}\n  code words\n  ${FENCE}`,
};

describe("measureStructure", () => {
  test.each(Object.entries(BODIES))("agrees with the eval measurement: %s", (_name, body) => {
    const evalMeasure = measureForEval(body);
    expect(measureStructure(body)).toEqual({
      visibleWords: evalMeasure.visibleWords,
      maxBlockWords: evalMeasure.maxBlockWords,
      proseCodeSpans: evalMeasure.proseCodeSpans,
      hiddenWords: evalMeasure.hiddenWords,
    });
  });

  test.each<[string, string, Structure]>([
    [
      "table cells",
      BODIES.table ?? "",
      { visibleWords: 3, maxBlockWords: 3, proseCodeSpans: 0, hiddenWords: 8 },
    ],
    [
      "details",
      BODIES["details block"] ?? "",
      { visibleWords: 2, maxBlockWords: 1, proseCodeSpans: 0, hiddenWords: 4 },
    ],
    [
      "fenced output",
      BODIES["fenced output"] ?? "",
      { visibleWords: 2, maxBlockWords: 1, proseCodeSpans: 0, hiddenWords: 7 },
    ],
    [
      "list items",
      BODIES["nested list"] ?? "",
      { visibleWords: 9, maxBlockWords: 3, proseCodeSpans: 1, hiddenWords: 0 },
    ],
  ])("measures %s", (_name, body, expected) => {
    expect(measureStructure(body)).toEqual(expected);
  });
});

describe("exceededLimits", () => {
  test.each<[string, Parameters<typeof exceededLimits>[0], string[]]>([
    ["at every limit", { visibleWords: 120, maxBlockWords: 40, proseCodeSpans: 6 }, []],
    ["words only", { visibleWords: 121, maxBlockWords: 40, proseCodeSpans: 6 }, ["visible words"]],
    [
      "all three",
      { visibleWords: 240, maxBlockWords: 52, proseCodeSpans: 9 },
      ["visible words", "longest paragraph or bullet words", "inline code spans"],
    ],
  ])("%s", (_name, structure, labels) => {
    expect(exceededLimits(structure).map((limit) => limit.label)).toEqual(labels);
  });
});
