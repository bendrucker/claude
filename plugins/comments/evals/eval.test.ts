import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrompt } from "../judge/judge";
import type { Verdict } from "../judge/schema";
import {
  alignVerdicts,
  clearVerdicts,
  type Fixture,
  fixtureToInput,
  fixtureToShardComment,
  loadFixtures,
  scoreResults,
} from "./eval";
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

describe("alignVerdicts", () => {
  const fixtures = [fixture({ id: "a" }), fixture({ id: "b" })];

  test("orders verdicts by fixture, not by the order the agents wrote them", () => {
    const map = new Map([
      ["b", verdict({ category: "narration" })],
      ["a", verdict({ category: "restate-the-what" })],
    ]);
    expect(alignVerdicts(fixtures, map).map((v) => v.category)).toEqual([
      "restate-the-what",
      "narration",
    ]);
  });

  test.each([
    ["a fixture the judge skipped", [["a", verdict({})]], /No verdict for 1 fixture\(s\): b/],
    [
      "a verdict from another job",
      [
        ["a", verdict({})],
        ["b", verdict({})],
        ["c", verdict({})],
      ],
      /Verdicts name 1 unknown comment\(s\): c/,
    ],
    [
      "a job dir belonging to another corpus, naming both causes",
      [["x", verdict({})]],
      /No verdict for 2 fixture\(s\): a, b\. Verdicts name 1 unknown comment\(s\): x/,
    ],
  ] as const)("rejects %s", (_name, entries, error) => {
    expect(() => alignVerdicts(fixtures, new Map(entries))).toThrow(error);
  });
});

describe("clearVerdicts", () => {
  test("drops a previous run's verdicts and leaves the rest of the job dir alone", async () => {
    const verdictsDir = join(await mkdtemp(join(tmpdir(), "comments-eval-test-")), "verdicts");
    await Bun.write(join(verdictsDir, "verdict-0.json"), "{}");
    await Bun.write(join(verdictsDir, "verdict-1.json"), "{}");
    await Bun.write(join(verdictsDir, "notes.txt"), "keep me");

    await clearVerdicts(verdictsDir);

    expect(await Bun.file(join(verdictsDir, "verdict-0.json")).exists()).toBe(false);
    expect(await Bun.file(join(verdictsDir, "verdict-1.json")).exists()).toBe(false);
    expect(await Bun.file(join(verdictsDir, "notes.txt")).exists()).toBe(true);
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
      expect(fixtureToShardComment(f)).toMatchObject({ id: f.id, text: f.comment });
      if (f.action === "rewrite") expect(f.rewrite?.length).toBeGreaterThan(0);
    }
  });
});

// The oracle's must-keep cross-check: it must never trim or rewrite a justified
// comment. The gate of record runs the same corpus through the production
// workflow (`eval.ts build`, then `score --gate`). This is the batched SDK
// second opinion, and it samples, so a run can differ. Self-skips without an
// API key, keeping CI off the API.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe("oracle must-keep check", () => {
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
