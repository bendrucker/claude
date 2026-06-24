import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  BATCH_SIZE,
  type CommentJudge,
  type CommentJudgeInput,
  formatBatch,
  judgeComments,
  loadPrompt,
  parseBatchVerdicts,
  sha256,
} from "./judge";
import type { Verdict } from "./schema";

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
    isSlop: true,
    category: "restate-the-what",
    confidence: "high",
    rationale: "Paraphrases the adjacent line.",
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
    const b = verdict({ isSlop: false, category: null, rationale: "b" });
    const json = batchJson([b, a], [1, 0]);
    const result = parseBatchVerdicts(json, 2);
    expect(result).toEqual([a, b]);
  });

  test("preserves optional suggestedFix and trimToLines", () => {
    const v = verdict({ suggestedFix: "delete it", trimToLines: [2, 3] });
    const result = parseBatchVerdicts(batchJson([v], [0]), 1);
    expect(result[0]).toEqual(v);
  });

  test("throws when an index is missing", () => {
    const json = batchJson([verdict(), verdict()], [0, 0]);
    expect(() => parseBatchVerdicts(json, 2)).toThrow(/appears more than once/);
  });

  test("throws when coverage is incomplete", () => {
    const json = batchJson([verdict()], [0]);
    expect(() => parseBatchVerdicts(json, 2)).toThrow(/covered 1 of 2/);
  });

  test("throws on a duplicate index", () => {
    const json = JSON.stringify({
      verdicts: [
        { index: 0, verdict: verdict() },
        { index: 0, verdict: verdict() },
      ],
    });
    expect(() => parseBatchVerdicts(json, 2)).toThrow(/appears more than once/);
  });

  test("throws on an out-of-range index", () => {
    const json = batchJson([verdict()], [5]);
    expect(() => parseBatchVerdicts(json, 1)).toThrow(/out of range/);
  });

  test("throws on invalid JSON", () => {
    expect(() => parseBatchVerdicts("not json", 1)).toThrow(/invalid JSON/);
  });

  test("throws when verdicts is not an array", () => {
    expect(() => parseBatchVerdicts(JSON.stringify({ verdicts: {} }), 1)).toThrow(
      /"verdicts" array/,
    );
  });
});

describe("formatBatch", () => {
  test("renders index, path, comment text, and context for each input", () => {
    const inputs = [
      input({ path: "a.ts", text: "// first" }),
      input({ path: "b.py", language: "python", text: "# second", context: "x = 1  # second" }),
    ];
    const rendered = formatBatch(inputs);
    expect(rendered).toContain("COMMENT 0");
    expect(rendered).toContain("COMMENT 1");
    expect(rendered).toContain("a.ts");
    expect(rendered).toContain("b.py");
    expect(rendered).toContain("// first");
    expect(rendered).toContain("# second");
    expect(rendered).toContain("x = 1  # second");
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
    const fake: CommentJudge = async (batch) => {
      callSizes.push(batch.length);
      return batch.map(() => verdict({ rationale: `r${cursor++}` }));
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
    const fake: CommentJudge = async () => {
      called = true;
      return [];
    };
    expect(await judgeComments(fake, [])).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("sha256", () => {
  test("is stable and hex", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("world"));
  });
});

describe("loadPrompt", () => {
  test("returns text and matching sha256 for a written file", async () => {
    const path = join(import.meta.dirname, `prompt-test-${process.pid}.md`);
    const body = "# judge prompt\nScore each comment.\n";
    await Bun.write(path, body);
    try {
      const prompt = await loadPrompt(path);
      expect(prompt.text).toBe(body);
      expect(prompt.sha256).toBe(sha256(body));
    } finally {
      await Bun.file(path).delete();
    }
  });
});
