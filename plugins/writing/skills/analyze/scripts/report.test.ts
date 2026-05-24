import { describe, expect, test } from "bun:test";
import type { CorrectionRow, ModelSummaryRow, PhraseLiftRow } from "./dump";
import { buildRuleHealth, renderReport } from "./report";
import type { WordlistEntry } from "./wordlists";

const baseInput = {
  generatedAt: "2026-05-24",
  since: "2026-04-24",
  until: "2026-05-24",
  modelFilter: "*opus*",
  projectFilter: null,
  minLift: 5,
  topN: 10,
  modelSummary: [] as ModelSummaryRow[],
  assistantTotalChars: 0,
  userTotalChars: 0,
  ruleHealth: [],
  candidatePhrases: [],
  corrections: [] as CorrectionRow[],
};

describe("buildRuleHealth", () => {
  const entries: WordlistEntry[] = [
    { phrase: "let me", source: "openers.txt" },
    { phrase: "missing entry", source: "openers.txt" },
  ];

  test("marks an entry with no data", () => {
    const result = buildRuleHealth(entries, new Map(), 5);
    expect(result[1]?.noData).toBe(true);
    expect(result[1]?.stillDistinctive).toBe(false);
  });

  test("computes lift across roles and decides distinctiveness", () => {
    const lift = new Map<string, PhraseLiftRow[]>();
    lift.set("let me", [
      {
        role: "assistant",
        model: "claude-opus-4-7",
        messages: 10,
        total_chars: 10_000,
        phrase_count: 50,
        per_1m_chars: 5000,
        lift_vs_user: 10,
      },
      {
        role: "user",
        model: null,
        messages: 10,
        total_chars: 10_000,
        phrase_count: 5,
        per_1m_chars: 500,
        lift_vs_user: null,
      },
    ]);
    const result = buildRuleHealth(entries, lift, 5);
    expect(result[0]?.noData).toBe(false);
    expect(result[0]?.stillDistinctive).toBe(true);
    expect(result[0]?.lift).toBeCloseTo(10, 0);
  });

  test("proposes removal when lift drops below threshold", () => {
    const lift = new Map<string, PhraseLiftRow[]>();
    lift.set("let me", [
      {
        role: "assistant",
        model: "claude-opus-4-7",
        messages: 10,
        total_chars: 10_000,
        phrase_count: 10,
        per_1m_chars: 1000,
        lift_vs_user: 2,
      },
      {
        role: "user",
        model: null,
        messages: 10,
        total_chars: 10_000,
        phrase_count: 5,
        per_1m_chars: 500,
        lift_vs_user: null,
      },
    ]);
    const result = buildRuleHealth(entries, lift, 5);
    expect(result[0]?.stillDistinctive).toBe(false);
  });
});

describe("renderReport", () => {
  test("includes header, summary, and section titles even when empty", () => {
    const output = renderReport(baseInput);
    expect(output).toContain("# Writing trope analysis");
    expect(output).toContain("## Summary");
    expect(output).toContain("## Proposed Wordlist Removals");
    expect(output).toContain("## Proposed Wordlist Additions");
    expect(output).toContain("## Current Rule Health");
    expect(output).toContain("## Correction Candidates");
  });

  test("renders proposed-removals diff block when entries collapse", () => {
    const entry: WordlistEntry = { phrase: "tapestry", source: "vocabulary.txt" };
    const output = renderReport({
      ...baseInput,
      ruleHealth: [
        {
          entry,
          assistantCount: 5,
          userCount: 10,
          assistantPerM: 50,
          userPerM: 100,
          lift: 0.5,
          stillDistinctive: false,
          noData: false,
        },
      ],
    });
    expect(output).toContain("- tapestry");
    expect(output).toContain("vocabulary.txt");
    expect(output).toContain("```diff");
  });

  test("renders proposed-additions diff block for high-lift phrases", () => {
    const output = renderReport({
      ...baseInput,
      candidatePhrases: [
        {
          phrase: "reaching for",
          n: 2,
          assistantCount: 20,
          userCount: 1,
          assistantPerM: 80,
          userPerM: 5,
          lift: 16,
        },
      ],
    });
    expect(output).toContain("+ reaching for");
    expect(output).toContain("lift=16.0");
  });

  test("renders correction snippets in their own subsections", () => {
    const output = renderReport({
      ...baseInput,
      corrections: [
        {
          session_id: "s1",
          project: "myproject",
          assistant_timestamp: "2026-05-20T10:00:00Z",
          user_timestamp: "2026-05-20T10:01:00Z",
          assistant_chars: 500,
          user_chars: 50,
          assistant_snippet: "long assistant response here",
          user_snippet: "no, do it differently",
        },
      ],
    });
    expect(output).toContain("### 2026-05-20T10:00:00Z (myproject)");
    expect(output).toContain("no, do it differently");
  });

  test("treats removals and additions as co-equal top-level sections", () => {
    const output = renderReport(baseInput);
    const removalIdx = output.indexOf("## Proposed Wordlist Removals");
    const additionIdx = output.indexOf("## Proposed Wordlist Additions");
    const healthIdx = output.indexOf("## Current Rule Health");
    expect(removalIdx).toBeGreaterThan(0);
    expect(additionIdx).toBeGreaterThan(removalIdx);
    expect(healthIdx).toBeGreaterThan(additionIdx);
  });
});
