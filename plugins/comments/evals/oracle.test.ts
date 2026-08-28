import { describe, expect, test } from "bun:test";
import { BATCH_SIZE } from "../judge/judge";
import type { Verdict } from "../judge/schema";
import {
  type CommentJudge,
  type CommentJudgeInput,
  formatBatch,
  judgeComments,
  parseBatchVerdicts,
} from "./oracle";

function input(overrides: Partial<CommentJudgeInput> = {}): CommentJudgeInput {
  return {
    path: "src/auth.ts",
    language: "typescript",
    kind: "line",
    text: "// increment the counter",
    context: "1: let counter = 0;\n2: counter += 1; // increment the counter",
    ...overrides,
  };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    action: "trim",
    category: "restate-the-what",
    confidence: "high",
    rationale: "Paraphrases the adjacent line.",
    rewrite: null,
    ...overrides,
  };
}

function batchJson(verdicts: Verdict[], indices: number[]): string {
  return JSON.stringify({
    verdicts: verdicts.map((v, i) => ({ index: indices[i], verdict: v })),
  });
}

describe("parseBatchVerdicts", () => {
  test("returns verdicts ordered by index with full coverage", () => {
    const a = verdict({ rationale: "a" });
    const b = verdict({ action: "keep", category: null, rationale: "b" });
    const json = batchJson([b, a], [1, 0]);
    const result = parseBatchVerdicts(json, 2);
    expect(result).toEqual([a, b]);
  });

  test("preserves optional suggestedFix and trimToLines", () => {
    const v = verdict({ suggestedFix: "delete it", trimToLines: [2, 3] });
    const result = parseBatchVerdicts(batchJson([v], [0]), 1);
    expect(result[0]).toEqual(v);
  });

  const duplicateIndex = JSON.stringify({
    verdicts: [
      { index: 0, verdict: verdict() },
      { index: 0, verdict: verdict() },
    ],
  });

  test.each<[string, string, number, RegExp]>([
    [
      "throws when an index is missing",
      batchJson([verdict(), verdict()], [0, 0]),
      2,
      /appears more than once/,
    ],
    ["throws when coverage is incomplete", batchJson([verdict()], [0]), 2, /covered 1 of 2/],
    ["throws on a duplicate index", duplicateIndex, 2, /appears more than once/],
    ["throws on an out-of-range index", batchJson([verdict()], [5]), 1, /out of range/],
    ["throws on invalid JSON", "not json", 1, /invalid JSON/],
    [
      "throws when verdicts is not an array",
      JSON.stringify({ verdicts: {} }),
      1,
      /"verdicts" array/,
    ],
  ])("%s", (_name, json, count, error) => {
    expect(() => parseBatchVerdicts(json, count)).toThrow(error);
  });
});

describe("formatBatch", () => {
  test("renders an indexed comment element with path, text, and context", () => {
    const inputs = [
      input({ path: "a.ts", text: "// first" }),
      input({ path: "b.py", language: "python", text: "# second", context: "x = 1  # second" }),
    ];
    const rendered = formatBatch(inputs);
    expect(rendered).toContain('index="0"');
    expect(rendered).toContain('index="1"');
    expect(rendered).toContain("<path>a.ts</path>");
    expect(rendered).toContain("<path>b.py</path>");
    expect(rendered).toContain("<text>// first</text>");
    expect(rendered).toContain("<text># second</text>");
    expect(rendered).toContain("x = 1  # second");
  });

  test("escapes XML-significant characters in the comment text", () => {
    const rendered = formatBatch([input({ text: "// a < b && c > d" })]);
    expect(rendered).toContain("&lt;");
    expect(rendered).toContain("&amp;");
    expect(rendered).not.toContain("// a < b");
  });

  test("is stable across calls", () => {
    const inputs = [input(), input({ path: "other.ts", text: "// other" })];
    expect(formatBatch(inputs)).toBe(formatBatch(inputs));
  });
});

describe("judgeComments", () => {
  test("chunks inputs across the BATCH_SIZE boundary and concatenates in order", async () => {
    const total = BATCH_SIZE * 2 + 5;
    const inputs = Array.from({ length: total }, (_, i) => input({ text: `// comment ${i}` }));
    const callSizes: number[] = [];
    let cursor = 0;
    const fake: CommentJudge = (batch) => {
      callSizes.push(batch.length);
      return Promise.resolve(batch.map(() => verdict({ rationale: `r${cursor++}` })));
    };

    const result = await judgeComments(fake, inputs);

    expect(callSizes).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    expect(result).toHaveLength(total);
    expect(result.map((v) => v.rationale)).toEqual(
      Array.from({ length: total }, (_, i) => `r${i}`),
    );
  });

  test("returns an empty array for no inputs without calling the judge", async () => {
    let called = false;
    const fake: CommentJudge = () => {
      called = true;
      return Promise.resolve([]);
    };
    expect(await judgeComments(fake, [])).toEqual([]);
    expect(called).toBe(false);
  });
});
