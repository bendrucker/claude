import { describe, expect, test } from "bun:test";
import { judgeComments, loadPrompt } from "../judge/judge";
import type { Verdict } from "../judge/schema";
import { type Fixture, fixtureToInput, loadFixtures, scoreResults } from "./eval";
import { anthropicCommentJudge } from "./oracle";

function fixture(over: Partial<Fixture>): Fixture {
  return {
    id: "f",
    path: "a.py",
    language: "python",
    kind: "line",
    comment: "# c",
    context: "1: x = 1",
    label: "slop",
    category: "restate-the-what",
    ...over,
  };
}

function verdict(over: Partial<Verdict>): Verdict {
  return {
    isSlop: true,
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    ...over,
  };
}

describe("scoreResults", () => {
  test("counts a confusion matrix and computes precision/recall", () => {
    const fixtures = [
      fixture({ id: "tp", label: "slop" }),
      fixture({ id: "fn", label: "slop" }),
      fixture({ id: "fp", label: "ok", category: null }),
      fixture({ id: "tn", label: "ok", category: null }),
    ];
    const verdicts = [
      verdict({ isSlop: true }),
      verdict({ isSlop: false, category: null }),
      verdict({ isSlop: true }),
      verdict({ isSlop: false, category: null }),
    ];
    const m = scoreResults(fixtures, verdicts);
    expect(m.truePositives).toBe(1);
    expect(m.falseNegatives).toBe(1);
    expect(m.falsePositives).toBe(1);
    expect(m.trueNegatives).toBe(1);
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.falsePositiveIds).toEqual(["fp"]);
    expect(m.falseNegativeIds).toEqual(["fn"]);
  });

  test("category match only counts when the flagged category equals the label", () => {
    const fixtures = [
      fixture({ id: "a", category: "restate-the-what" }),
      fixture({ id: "b", category: "narration" }),
    ];
    const verdicts = [
      verdict({ isSlop: true, category: "restate-the-what" }),
      verdict({ isSlop: true, category: "restate-the-what" }),
    ];
    const m = scoreResults(fixtures, verdicts);
    expect(m.truePositives).toBe(2);
    expect(m.categoryMatches).toBe(1);
  });

  test("a corpus with no positives yields recall 1 and precision 1 when nothing is flagged", () => {
    const fixtures = [fixture({ id: "n", label: "ok", category: null })];
    const m = scoreResults(fixtures, [verdict({ isSlop: false, category: null })]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
  });

  test("throws when verdict count does not match fixtures", () => {
    expect(() => scoreResults([fixture({})], [])).toThrow();
  });
});

describe("fixture corpus", () => {
  test("every committed fixture is valid and the corpus has both labels", async () => {
    const fixtures = await loadFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.some((f) => f.label === "slop")).toBe(true);
    expect(fixtures.some((f) => f.label === "ok")).toBe(true);
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of fixtures) {
      expect(f.context.length).toBeGreaterThan(0);
      expect(fixtureToInput(f).text).toBe(f.comment);
    }
  });
});

// Live ship gate: the judge must not flag any must-pass `ok` fixture. Self-skips
// without an API key so CI stays deterministic; run locally with ANTHROPIC_API_KEY.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe("ship gate", () => {
  test.skipIf(!hasKey)(
    "judge flags zero must-pass negatives",
    async () => {
      const fixtures = (await loadFixtures()).filter((f) => f.label === "ok");
      const prompt = await loadPrompt();
      const judge = anthropicCommentJudge({ prompt: prompt.text });
      const verdicts = await judgeComments(judge, fixtures.map(fixtureToInput));
      const flagged = fixtures.filter((_, i) => verdicts[i]?.isSlop).map((f) => f.id);
      expect(flagged).toEqual([]);
    },
    120_000,
  );
});
