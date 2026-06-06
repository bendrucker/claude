import { describe, expect, test } from "bun:test";
import type { DeliverableAudit } from "./deliverable-audit";
import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import type { CandidatePhrase, FtsAuditRow } from "./report";
import { buildRuleHealth, renderReport } from "./report";
import type { VoiceProfile } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";

const baseInput = {
  generatedAt: "2026-05-24",
  since: "2026-04-24",
  until: "2026-05-24",
  modelFilter: "*opus*",
  projectFilter: null,
  minLift: 5,
  minCount: 5,
  topN: 10,
  modelSummary: [] as ModelSummaryRow[],
  assistantTotalChars: 0,
  deliverableTotalChars: 0,
  userTotalChars: 0,
  voiceProfile: null,
  ruleHealth: [],
  structuralAudit: [],
  structuralSignatures: [],
  candidatePhrases: [] as CandidatePhrase[],
  corrections: [] as CorrectionRow[],
  corrective: [] as CorrectiveRow[],
};

function chatAudit(entry: string, row: Omit<FtsAuditRow, "term">): Map<string, FtsAuditRow> {
  return new Map([[entry, { term: entry, ...row }]]);
}

describe("buildRuleHealth (chat surface)", () => {
  const entries: WordlistEntry[] = [
    { phrase: "let me", source: "openers.txt" },
    { phrase: "missing entry", source: "openers.txt" },
  ];

  test("marks a missing audit row as dead (no occurrences)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[1]?.noData).toBe(true);
    expect(result[1]?.status).toBe("remove");
    expect(result[1]?.removeReason).toBe("dead");
  });

  test("keeps a rule the model uses more than the user", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 50,
        user_count: 5,
        assistant_per_m: 5000,
        user_per_m: 500,
        lift: 10,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.surface).toBe("chat");
    expect(result[0]?.removeReason).toBeNull();
    expect(result[0]?.lift).toBeCloseTo(10, 0);
  });

  test("keeps a rare-but-distinctive rule even when lift reads low", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 32,
        user_count: 0,
        assistant_per_m: 296.8,
        user_per_m: 0,
        lift: 3.0,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("keep");
  });

  test("removes a rule the user uses at least as much (not distinctive)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 10,
        user_count: 40,
        assistant_per_m: 100,
        user_per_m: 200,
        lift: 0.5,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("not distinctive");
  });

  test("removes a rule below the occurrence floor (dead)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("let me", {
        assistant_count: 2,
        user_count: 0,
        assistant_per_m: 18.5,
        user_per_m: 0,
        lift: 0.2,
      }),
      deliverableAudit: null,
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("dead");
  });
});

describe("buildRuleHealth (deliverable surface)", () => {
  const entries: WordlistEntry[] = [{ phrase: "source of truth", source: "flowery-phrases.txt" }];

  const profile: VoiceProfile = {
    documentCount: 1,
    totalTokens: 1000,
    ngrams: { "1": {}, "2": {}, "3": {} },
    stemmedNgrams: { "1": {}, "2": {}, "3": {} },
    totalStemmedTokens: 1000,
    generatedAt: "2026-05-24",
    sources: ["github"],
  };

  function deliverableAudit(count: number, perMillion: number): DeliverableAudit {
    return { totalTokens: 100000, byPhrase: new Map([["source of truth", { count, perMillion }]]) };
  }

  test("keeps a deliverable tell frequent in deliverables and absent from baseline", () => {
    // The chat audit would call this dead (0 chat hits). The deliverable audit
    // sees it 78 times in deliverable prose and never in the voice baseline.
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("source of truth", {
        assistant_count: 0,
        user_count: 0,
        assistant_per_m: 0,
        user_per_m: 0,
        lift: null,
      }),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: profile,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.modelCount).toBe(78);
    expect(result[0]?.baselinePerM).toBe(0);
  });

  test("removes a deliverable tell present in the baseline (not distinctive)", () => {
    const baselineProfile: VoiceProfile = {
      ...profile,
      stemmedNgrams: { "1": {}, "2": {}, "3": { "sourc of truth": 200 } },
    };
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: baselineProfile,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("not distinctive");
  });

  test("keeps a deliverable tell pending a baseline when no profile is loaded", () => {
    // No profile: the multi-word phrase must NOT fall back to the chat audit
    // (which can't match it and would call it dead). It stays on the deliverable
    // surface and, being alive there, is kept with distinctiveness unverified.
    const result = buildRuleHealth({
      entries,
      chatAudit: chatAudit("source of truth", {
        assistant_count: 0,
        user_count: 0,
        assistant_per_m: 0,
        user_per_m: 0,
        lift: null,
      }),
      deliverableAudit: deliverableAudit(78, 122.7),
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("keep");
    expect(result[0]?.removeReason).toBeNull();
    expect(result[0]?.baselinePerM).toBeNull();
    expect(result[0]?.noData).toBe(true);
  });

  test("marks a deliverable rule dead when it rarely fires on its own surface (no profile)", () => {
    const result = buildRuleHealth({
      entries,
      chatAudit: new Map(),
      deliverableAudit: deliverableAudit(0, 0),
      voiceProfile: null,
      minCount: 5,
    });
    expect(result[0]?.surface).toBe("deliverable");
    expect(result[0]?.status).toBe("remove");
    expect(result[0]?.removeReason).toBe("dead");
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
    expect(output).toContain("## Structural Signatures");
    expect(output).toContain("## Correction Candidates");
  });

  test("renders structural signature rows with example sentences", () => {
    const output = renderReport({
      ...baseInput,
      structuralSignatures: [
        {
          phrase: "COPULA PART DET NOUN",
          n: 4,
          assistantCount: 40,
          userCount: 2,
          assistantPerM: 120,
          userPerM: 10,
          lift: 8.4,
          sessions: 6,
          example: "This is not a cache, it is a ledger",
        },
      ],
    });
    expect(output).toContain("`COPULA PART DET NOUN`");
    expect(output).toContain("This is not a cache, it is a ledger");
  });

  test("renders proposed-removals diff block when entries collapse", () => {
    const entry: WordlistEntry = { phrase: "tapestry", source: "vocabulary.txt" };
    const output = renderReport({
      ...baseInput,
      ruleHealth: [
        {
          entry,
          surface: "chat",
          modelCount: 5,
          modelPerM: 50,
          baselinePerM: 100,
          lift: 0.5,
          status: "remove",
          removeReason: "not distinctive",
          noData: false,
          quote: null,
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
          baselineCount: 0,
          baselinePerM: 0,
          quote: null,
        },
      ],
    });
    expect(output).toContain("+ reaching for");
    expect(output).toContain("lift=16.0");
    expect(output).toContain("baseline=0");
  });

  test("renders corrective-feedback moments with matched term", () => {
    const output = renderReport({
      ...baseInput,
      corrective: [
        {
          session_id: "s1",
          project: "myproject",
          timestamp: "2026-05-20T10:01:00Z",
          user_chars: 40,
          user_text: "ugh this reads like marketing fluff",
          user_source_file: "f.jsonl",
          user_source_line: 12,
          matched_term: "fluff",
          context_chars: 300,
          context_snippet: "the model wrote a flowery paragraph",
        },
      ],
    });
    expect(output).toContain("## Corrective Feedback");
    expect(output).toContain("matched `fluff`");
    expect(output).toContain("reads like marketing fluff");
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

  test("labels openers and vocabulary rules with type column", () => {
    const output = renderReport({
      ...baseInput,
      ruleHealth: [
        {
          entry: { phrase: "Perfect", source: "openers.txt" },
          surface: "chat",
          modelCount: 10,
          modelPerM: 100,
          baselinePerM: 20,
          lift: 5,
          status: "keep",
          removeReason: null,
          noData: false,
          quote: null,
        },
        {
          entry: { phrase: "tapestry", source: "vocabulary.txt" },
          surface: "chat",
          modelCount: 5,
          modelPerM: 50,
          baselinePerM: 10,
          lift: 5,
          status: "keep",
          removeReason: null,
          noData: false,
          quote: null,
        },
      ],
    });
    expect(output).toContain("| type |");
    expect(output).toMatch(/Perfect.*opener/);
    expect(output).toMatch(/tapestry.*vocabulary/);
  });

  test("orders sections: summary, removals, additions, health", () => {
    const output = renderReport(baseInput);
    const summaryIdx = output.indexOf("## Summary");
    const removalIdx = output.indexOf("## Proposed Wordlist Removals");
    const additionIdx = output.indexOf("## Proposed Wordlist Additions");
    const healthIdx = output.indexOf("## Current Rule Health");
    expect(summaryIdx).toBeGreaterThan(0);
    expect(removalIdx).toBeGreaterThan(summaryIdx);
    expect(additionIdx).toBeGreaterThan(removalIdx);
    expect(healthIdx).toBeGreaterThan(additionIdx);
  });
});
