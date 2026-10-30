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
  "paths and contrast":
    "Moves `src/cache.ts` and `config.yaml` instead of `opts.cases`, so that reads work.\n\n- Without `scripts/run.sh` (`run()`)\n\n> rather than `a/b`",
};

describe("measureStructure", () => {
  test.each(Object.entries(BODIES))("agrees with the eval measurement: %s", (_name, body) => {
    const evalMeasure = measureForEval(body);
    expect(measureStructure(body)).toEqual({
      proseWords: evalMeasure.proseWords,
      listWords: evalMeasure.listWords,
      maxBlockWords: evalMeasure.maxBlockWords,
      proseCodeSpans: evalMeasure.proseCodeSpans,
      hiddenWords: evalMeasure.hiddenWords,
      pathSpans: evalMeasure.pathSpans,
      contrastPhrases: evalMeasure.contrastPhrases,
    });
  });

  test.each<[string, string, Structure]>([
    [
      "table cells",
      BODIES.table ?? "",
      {
        proseWords: 3,
        listWords: 0,
        maxBlockWords: 3,
        proseCodeSpans: 0,
        hiddenWords: 8,
        pathSpans: 0,
        contrastPhrases: 0,
      },
    ],
    [
      "details",
      BODIES["details block"] ?? "",
      {
        proseWords: 2,
        listWords: 0,
        maxBlockWords: 1,
        proseCodeSpans: 0,
        hiddenWords: 4,
        pathSpans: 0,
        contrastPhrases: 0,
      },
    ],
    [
      "fenced output",
      BODIES["fenced output"] ?? "",
      {
        proseWords: 2,
        listWords: 0,
        maxBlockWords: 1,
        proseCodeSpans: 0,
        hiddenWords: 7,
        pathSpans: 0,
        contrastPhrases: 0,
      },
    ],
    [
      "list items",
      BODIES["nested list"] ?? "",
      {
        proseWords: 0,
        listWords: 9,
        maxBlockWords: 3,
        proseCodeSpans: 1,
        hiddenWords: 0,
        pathSpans: 0,
        contrastPhrases: 0,
      },
    ],
    [
      "paths and contrast",
      BODIES["paths and contrast"] ?? "",
      {
        proseWords: 16,
        listWords: 4,
        maxBlockWords: 12,
        proseCodeSpans: 6,
        hiddenWords: 0,
        pathSpans: 4,
        contrastPhrases: 4,
      },
    ],
  ])("measures %s", (_name, body, expected) => {
    expect(measureStructure(body)).toEqual(expected);
  });
});

describe("exceededLimits", () => {
  test.each<[string, Parameters<typeof exceededLimits>[0], string[]]>([
    [
      "at every limit",
      {
        proseWords: 120,
        maxBlockWords: 40,
        proseCodeSpans: 6,
        pathSpans: 1,
        contrastPhrases: 1,
      },
      [],
    ],
    [
      "prose words only",
      {
        proseWords: 121,
        maxBlockWords: 40,
        proseCodeSpans: 6,
        pathSpans: 1,
        contrastPhrases: 1,
      },
      ["prose words"],
    ],
    [
      "every limit",
      {
        proseWords: 240,
        maxBlockWords: 52,
        proseCodeSpans: 9,
        pathSpans: 2,
        contrastPhrases: 3,
      },
      [
        "prose words",
        "longest paragraph or bullet words",
        "inline code spans",
        "file paths in inline code",
        "contrast phrases (instead of, rather than, so that, without)",
      ],
    ],
  ])("%s", (_name, structure, labels) => {
    expect(exceededLimits(structure).map((limit) => limit.label)).toEqual(labels);
  });

  test("a long list passes when its prose fits", () => {
    const prose = Array.from({ length: 3 }, () => "word ".repeat(30).trim()).join("\n\n");
    const list = Array.from({ length: 12 }, () => `- ${"item ".repeat(30).trim()}`).join("\n");
    expect(exceededLimits(measureStructure(`${prose}\n\n${list}`))).toEqual([]);
  });
});
