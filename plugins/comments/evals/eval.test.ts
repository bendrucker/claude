import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrompt } from "../judge/judge";
import type { Verdict } from "../judge/schema";
import {
  alignVerdicts,
  carriesFact,
  clearVerdicts,
  type Fixture,
  fixtureToInput,
  fixtureToShardComment,
  gateFailures,
  loadFixtures,
  RECALL_FLOOR,
  RETENTION_CEILING,
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
    expect(m.mismatches).toEqual([
      { id: "keep-violated", expected: "keep", predicted: "trim", reason: "action" },
    ]);
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

  const keepWithFact = fixture({
    id: "keep",
    action: "keep",
    category: null,
    comment: "# Retries share a backoff.\n# The broker rate-limits per key.",
    fact: ["rate-limits per key"],
  });

  test.each([
    ["keep", verdict({ action: "keep", category: null }), true],
    [
      "a trim that carries the fact",
      verdict({ trimTo: "# The broker rate-limits\n# per KEY." }),
      true,
    ],
    [
      "a rewrite that carries the fact",
      verdict({ action: "rewrite", rewrite: "# rate-limits per key" }),
      true,
    ],
    ["a trim that drops the fact", verdict({ trimTo: "# Retries share a backoff." }), false],
    ["a whole-comment trim", verdict({}), false],
    ["a line-range trim that keeps the fact", verdict({ trimToLines: [2] }), true],
  ] as const)("a keep fixture judged %s passes: %p", (_name, v, passed) => {
    const m = scoreResults([keepWithFact], [v]);
    expect(m.keepViolations).toEqual(passed ? [] : ["keep"]);
    expect(m.headline.destructive).toBe(passed ? 0 : 1);
  });

  const trimWithGold = fixture({
    id: "gold",
    comment: "# Walk the queue and retry. The broker rate-limits per key.",
    trimTo: "# The broker rate-limits per key.",
    fact: ["rate-limits per key"],
  });

  test.each([
    ["the gold trim", verdict({ trimTo: "# The broker rate-limits per key." }), true],
    [
      "a rewrite that carries the fact",
      verdict({
        action: "rewrite",
        category: "voice",
        rewrite: "# Broker rate-limits per key.",
      }),
      true,
    ],
    ["a whole-comment trim", verdict({}), false],
    [
      "a trim that echoes the comment",
      verdict({ trimTo: "# Walk the queue and retry. The broker rate-limits per key." }),
      false,
    ],
    ["keep", verdict({ action: "keep", category: null }), false],
  ] as const)("a trimTo fixture judged %s passes: %p", (_name, v, passed) => {
    expect(scoreResults([trimWithGold], [v]).correct).toBe(passed ? 1 : 0);
  });

  test("records surviving chars against the gold trimTo", () => {
    const m = scoreResults(
      [trimWithGold, { ...trimWithGold, id: "gold-2" }],
      [
        verdict({ trimTo: "# The broker rate-limits per key." }),
        verdict({ trimTo: "# Walk the queue and retry. The broker rate-limits per key." }),
      ],
    );
    expect(m.retention.gold).toBe(1);
    expect(m.retention["gold-2"]).toBeCloseTo(59 / 33);
    expect(m.meanRetention).toBeCloseTo((1 + 59 / 33) / 2);
    expect(m.mismatches).toEqual([
      { id: "gold-2", expected: "trim", predicted: "trim", reason: "retention" },
    ]);
  });

  test("splits keep precision and slop recall between headline and quoted fixtures", () => {
    const fixtures = [
      { ...keepWithFact, id: "k1" },
      { ...keepWithFact, id: "k2" },
      fixture({ id: "t1" }),
      fixture({ id: "t2" }),
      fixture({ id: "r1", action: "rewrite", category: "voice", rewrite: "# fact" }),
      { ...keepWithFact, id: "kq", quoted: "per key" },
      fixture({ id: "tq", quoted: "c" }),
    ];
    const verdicts = [
      verdict({ action: "keep", category: null }),
      verdict({}),
      verdict({}),
      verdict({ action: "keep", category: null }),
      verdict({ action: "trim" }),
      verdict({}),
      verdict({}),
    ];
    const m = scoreResults(fixtures, verdicts);
    expect(m.headline).toEqual({
      keeps: 2,
      destructive: 1,
      keepPrecision: 0.5,
      slop: 3,
      flagged: 2,
      slopRecall: 2 / 3,
    });
    expect(m.quoted).toMatchObject({ keeps: 1, destructive: 1, slop: 1, flagged: 1 });
    expect(m.keepViolations).toEqual(["k2", "kq"]);
  });

  test("throws when verdict count does not match fixtures", () => {
    expect(() => scoreResults([fixture({})], [])).toThrow();
  });
});

describe("carriesFact", () => {
  test.each([
    [
      "a fact rewrapped across comment lines",
      "# the broker\n# rate-limits per key",
      "rate-limits per key",
      true,
    ],
    ["a fact inside markup quotes", '"""Prefers ``IsNameField``."""', "IsNameField", true],
    [
      "a fact in a block comment, different case",
      "/**\n * Rate-Limits\n * per key\n */",
      "rate-limits per key",
      true,
    ],
    ["a paraphrase", "# the broker throttles each key", "rate-limits per key", false],
    ["a number inside a larger number", "// weight 12.5, threshold 3.0", "2.5", false],
    ["a phrase with trailing brackets", "# referenceTo is VARCHAR[].", "VARCHAR[]", true],
  ])("%s: %p", (_name, text, fact, expected) => {
    expect(carriesFact(text, [fact])).toBe(expected);
  });

  test("requires every phrase", () => {
    expect(carriesFact("# 2.5 each", ["2.5", "3.0"])).toBe(false);
  });
});

describe("gateFailures", () => {
  test("fails on a dropped keep fact and on slop recall under the floor", () => {
    const keep = fixture({
      id: "k",
      action: "keep",
      category: null,
      comment: "# fact",
      fact: ["fact"],
    });
    const trim = fixture({ id: "t" });
    const passing = scoreResults(
      [keep, trim],
      [verdict({ action: "keep", category: null }), verdict({})],
    );
    expect(gateFailures(passing)).toEqual([]);

    const keepsEverything = scoreResults([trim], [verdict({ action: "keep", category: null })]);
    expect(gateFailures(keepsEverything)).toEqual([
      `headline slop recall 0.00 is under the ${RECALL_FLOOR.toFixed(2)} floor`,
    ]);

    const destructive = scoreResults([keep], [verdict({})]);
    expect(gateFailures(destructive)).toEqual([
      "judge dropped the fact from 1 must-keep comment(s): k",
    ]);
  });

  test("fails a trim whose surviving text passes the retention ceiling", () => {
    const trim = fixture({
      id: "t",
      comment: "# Walk the queue and retry. The broker rate-limits per key.",
      trimTo: "# The broker rate-limits per key.",
      fact: ["rate-limits per key"],
    });
    const within = verdict({ trimTo: "# Retry: the broker rate-limits per key." });
    expect(40 / 59).toBeLessThan(RETENTION_CEILING);
    expect(gateFailures(scoreResults([trim], [within]))).toEqual([]);
    const barely = verdict({ trimTo: "# Walk the queue, retry. The broker rate-limits per key." });
    expect(56 / 59).toBeGreaterThan(RETENTION_CEILING);
    expect(gateFailures(scoreResults([trim], [barely]))).toEqual([
      `judge's trim kept over ${RETENTION_CEILING.toFixed(2)} of the comment on 1 comment(s): t`,
    ]);
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

  test("every quoted phrase still appears in the rubric", async () => {
    const prompt = (await loadPrompt()).text;
    const quoted = (await loadFixtures()).filter((f) => f.quoted != null);
    expect(quoted.length).toBeGreaterThan(0);
    for (const f of quoted) {
      expect({ id: f.id, quoted: carriesFact(prompt, [f.quoted ?? ""]) }).toEqual({
        id: f.id,
        quoted: true,
      });
    }
  });
});

describe("fixture validation", () => {
  const base = {
    id: "x",
    path: "a.py",
    language: "python",
    kind: "line",
    comment: "# the broker rate-limits per key",
    context: "1: x = 1",
  };

  test.each([
    ["a keep with no fact", { action: "keep" }, /needs a "fact"/],
    [
      "a fact missing from the comment",
      { action: "keep", fact: "backoff" },
      /does not appear in its comment/,
    ],
    [
      "a gold trimTo over the retention ceiling",
      {
        action: "trim",
        category: "restate-the-what",
        trimTo: "# The broker rate-limits per key",
        fact: "rate-limits",
      },
      /over the retention ceiling itself/,
    ],
    [
      "a fact missing from the gold trimTo",
      { action: "trim", category: "restate-the-what", trimTo: "# per key", fact: "rate-limits" },
      /does not appear in its trimTo/,
    ],
  ] as const)("rejects %s", async (_name, over, message) => {
    const dir = await mkdtemp(join(tmpdir(), "comments-eval-fixture-"));
    await Bun.write(join(dir, "x.json"), JSON.stringify({ ...base, ...over }));
    const thrown = await loadFixtures(dir).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(message);
  });
});

// The oracle's must-keep cross-check: it must never drop a justified comment's
// fact. The gate of record runs the same corpus through the production
// workflow (`eval.ts build`, then `score --gate`). This is the batched SDK
// second opinion, and it samples, so a run can differ. Self-skips without an
// API key, keeping CI off the API.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe("oracle must-keep check", () => {
  test.skipIf(!hasKey)(
    "judge keeps every must-keep fact",
    async () => {
      const fixtures = (await loadFixtures()).filter((f) => f.action === "keep");
      const prompt = await loadPrompt();
      const judge = anthropicCommentJudge({ prompt: prompt.text });
      const verdicts = await judgeComments(judge, fixtures.map(fixtureToInput));
      expect(scoreResults(fixtures, verdicts).keepViolations).toEqual([]);
    },
    120_000,
  );
});
