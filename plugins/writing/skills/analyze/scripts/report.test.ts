import { describe, expect, test } from "bun:test";
import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import { type CandidatePhrase, renderReport } from "./report";
import type { FeatureRate } from "./voice-delta";
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
  voiceDeltaRates: new Map(),
  ruleHealth: [],
  structuralAudit: [],
  structuralSignatures: [],
  rateTrends: {
    documentCount: 0,
    meanActionVerbOpenerRate: 0,
    meanBacktickRefDensity: 0,
    templateDocumentRate: 0,
    sectionCountDistribution: {},
    templateOnSmallDocumentCount: 0,
  },
  meaningAudit: null,
  candidatePhrases: [] as CandidatePhrase[],
  corrections: [] as CorrectionRow[],
  corrective: [] as CorrectiveRow[],
};

describe("renderReport", () => {
  test("includes header, summary, and section titles even when empty", () => {
    const output = renderReport(baseInput);
    expect(output).toContain("# Writing trope analysis");
    expect(output).toContain("## Summary");
    expect(output).toContain("## Voice Delta");
    expect(output).toContain("## Proposed Wordlist Removals");
    expect(output).toContain("## Proposed Wordlist Additions");
    expect(output).toContain("## Current Rule Health");
    expect(output).toContain("## Structural Signatures");
    expect(output).toContain("## Structural Trends");
    expect(output).toContain("## Correction Candidates");
  });

  test("renders structural trends table when documents are present", () => {
    const output = renderReport({
      ...baseInput,
      rateTrends: {
        documentCount: 42,
        meanActionVerbOpenerRate: 0.166,
        meanBacktickRefDensity: 58.3,
        templateDocumentRate: 0.73,
        sectionCountDistribution: { 0: 11, 1: 5, 2: 26 },
        templateOnSmallDocumentCount: 7,
      },
    });
    expect(output).toContain("## Structural Trends");
    expect(output).toContain("42");
    expect(output).toContain("action-verb opener rate");
    expect(output).toContain("backtick ref density");
    expect(output).toContain("template document rate");
    expect(output).toContain("template on small document");
    expect(output).toContain("7 docs");
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

  test("explains how to enable the meaning audit when the judge did not run", () => {
    const output = renderReport(baseInput);
    expect(output).toContain("## Meaning-Layer Audit (LLM Judge)");
    expect(output).toContain("Judge not run");
  });

  test("renders meaning-audit flag rates, prompt hash, and sampled spans", () => {
    const output = renderReport({
      ...baseInput,
      meaningAudit: {
        promptSha256: "abc123def456",
        model: "claude-haiku-4-5",
        documents: 40,
        estimatedCostUsd: 0.1234,
        criteria: [
          {
            id: "information-density",
            question: "Does this text tell the reviewer anything new?",
            flagged: 12,
            total: 40,
            spans: ["These changes ensure\ncorrect behavior."],
          },
          {
            id: "sycophancy",
            question: "Does the text flatter the reader?",
            flagged: 0,
            total: 40,
            spans: [],
          },
        ],
      },
    });
    expect(output).toContain("Prompt: `abc123def456`");
    expect(output).toContain("| information-density |");
    expect(output).toContain("| 12/40 | 30% |");
    // Multi-line spans are flattened so they cannot break the list item.
    expect(output).toContain('information-density: "These changes ensure correct behavior."');
    expect(output).toContain("| sycophancy |");
    expect(output).not.toContain('sycophancy: "');
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
          prose_signal: true,
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

// Invented fixture profile. Rates are made-up numbers, never real baseline
// content, which stays in the local data dir.
const fixtureProfile: VoiceProfile = {
  documentCount: 5,
  totalTokens: 1200,
  ngrams: {},
  stemmedNgrams: {},
  totalStemmedTokens: 1100,
  generatedAt: "2026-01-01",
  sources: ["github"],
  voiceDelta: {
    rates: { first_person_rate: 9.5, template_presence: 0.1 },
    documentCount: 5,
    computedAt: "2026-01-01",
  },
};

function rateEntry(featureId: string, rate: number): [string, FeatureRate] {
  return [featureId, { featureId, rate, documentCount: 4 }];
}

describe("renderReport voice delta", () => {
  test("renders rates-only table with a hint when no baseline is loaded", () => {
    const output = renderReport({
      ...baseInput,
      voiceDeltaRates: new Map([rateEntry("first_person_rate", 3.2)]),
    });
    expect(output).toContain("No voice-delta baseline loaded");
    expect(output).toContain("| feature | provenance | corpus rate |");
    expect(output).toContain("| First-person voice (I/we per 1k) | skill-encouraged | 3.20 |");
  });

  test("treats a profile without voiceDelta stats as no baseline", () => {
    const { voiceDelta: _omitted, ...legacyProfile } = fixtureProfile;
    const output = renderReport({
      ...baseInput,
      voiceProfile: legacyProfile,
    });
    expect(output).toContain("No voice-delta baseline loaded");
  });

  test("renders corpus rate, baseline rate, and delta per feature", () => {
    const output = renderReport({
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("first_person_rate", 3.2)]),
    });
    expect(output).toContain("Baseline: 5 documents (computed 2026-01-01)");
    expect(output).toContain("| feature | provenance | corpus rate | baseline rate | delta |");
    expect(output).toContain(
      "| First-person voice (I/we per 1k) | skill-encouraged | 3.20 | 9.50 | -6.30 |",
    );
  });

  test("formats fraction features as percentages with pp deltas", () => {
    const output = renderReport({
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("template_presence", 0.6)]),
    });
    expect(output).toContain(
      "| Template presence (## Changes + ## Testing) | skill-prescribed | 60% | 10% | +50.0pp |",
    );
  });

  test("marks features missing from the baseline stats", () => {
    const output = renderReport({
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("url_rate", 2.5)]),
    });
    expect(output).toContain(
      "| URL cross-references (per 1k words) | ungoverned | 2.50 | (no baseline stat) | - |",
    );
  });

  test("labels every feature row with its provenance", () => {
    const output = renderReport({
      ...baseInput,
      voiceProfile: fixtureProfile,
    });
    const section = output.slice(
      output.indexOf("## Voice Delta"),
      output.indexOf("## Proposed Wordlist Removals"),
    );
    const rows = section
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.includes("--- ") && !l.startsWith("| feature"));
    expect(rows.length).toBe(14);
    for (const row of rows) {
      expect(row).toMatch(/\| (skill-prescribed|skill-encouraged|ungoverned) \|/);
    }
  });
});
