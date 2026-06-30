import { describe, expect, test } from "bun:test";
import { loadPrompt } from "../judge/judge";
import type { Verdict } from "../judge/schema";
import { type Fixture, fixtureToInput, loadFixtures, scoreResults } from "./eval";
import { anthropicCommentJudge, judgeComments } from "./oracle";

function fixture(over: Partial<Fixture>): Fixture {
  return {
    id: "f",
    path: "a.py",
    language: "python",
    kind: "line",
    comment: "# c",
    context: "1: x = 1",
    action: "trim",
    category: "restate-the-what",
    ...over,
  };
}

function verdict(over: Partial<Verdict>): Verdict {
  return {
    action: "trim",
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    rewrite: null,
    ...over,
  };
}

describe("scoreResults", () => {
  test("scores action accuracy and isolates destructive keep violations", () => {
    const fixtures = [
      fixture({ id: "trim-ok", action: "trim" }),
      fixture({ id: "rewrite-ok", action: "rewrite", category: "voice", rewrite: "# fact" }),
      fixture({ id: "keep-violated", action: "keep", category: null }),
      fixture({ id: "keep-ok", action: "keep", category: null }),
    ];
    const verdicts = [
      verdict({ action: "trim" }),
      verdict({ action: "rewrite", category: "voice", rewrite: "# fact" }),
      verdict({ action: "trim" }),
      verdict({ action: "keep", category: null }),
    ];
    const m = scoreResults(fixtures, verdicts);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(3);
    expect(m.accuracy).toBeCloseTo(0.75);
    expect(m.mismatches).toEqual([{ id: "keep-violated", expected: "keep", predicted: "trim" }]);
    expect(m.keepViolations).toEqual(["keep-violated"]);
  });

  test("category match only counts when an action match also matches the category", () => {
    const fixtures = [
      fixture({ id: "a", action: "trim", category: "restate-the-what" }),
      fixture({ id: "b", action: "trim", category: "narration" }),
    ];
    const verdicts = [
      verdict({ action: "trim", category: "restate-the-what" }),
      verdict({ action: "trim", category: "restate-the-what" }),
    ];
    const m = scoreResults(fixtures, verdicts);
    expect(m.correct).toBe(2);
    expect(m.categoryMatches).toBe(1);
  });

  test("a clean keep corpus yields accuracy 1 and no violations", () => {
    const fixtures = [fixture({ id: "n", action: "keep", category: null })];
    const m = scoreResults(fixtures, [verdict({ action: "keep", category: null })]);
    expect(m.accuracy).toBe(1);
    expect(m.keepViolations).toEqual([]);
  });

  test("throws when verdict count does not match fixtures", () => {
    expect(() => scoreResults([fixture({})], [])).toThrow();
  });
});

describe("fixture corpus", () => {
  test("every committed fixture is valid and the corpus spans all three actions", async () => {
    const fixtures = await loadFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.some((f) => f.action === "keep")).toBe(true);
    expect(fixtures.some((f) => f.action === "trim")).toBe(true);
    expect(fixtures.some((f) => f.action === "rewrite")).toBe(true);
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of fixtures) {
      expect(f.context.length).toBeGreaterThan(0);
      expect(fixtureToInput(f).text).toBe(f.comment);
      if (f.action === "rewrite") expect(f.rewrite?.length).toBeGreaterThan(0);
    }
  });
});

// Live ship gate: the judge must keep every must-keep fixture (never trim or
// rewrite a justified comment). Self-skips without an API key so CI stays
// deterministic; run locally with ANTHROPIC_API_KEY.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe("ship gate", () => {
  test.skipIf(!hasKey)(
    "judge keeps every must-keep comment",
    async () => {
      const fixtures = (await loadFixtures()).filter((f) => f.action === "keep");
      const prompt = await loadPrompt();
      const judge = anthropicCommentJudge({ prompt: prompt.text });
      const verdicts = await judgeComments(judge, fixtures.map(fixtureToInput));
      const violated = fixtures.filter((_, i) => verdicts[i]?.action !== "keep").map((f) => f.id);
      expect(violated).toEqual([]);
    },
    120_000,
  );
});
