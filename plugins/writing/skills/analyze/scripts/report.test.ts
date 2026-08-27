import { describe, expect, test } from "bun:test";
import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import { type CandidatePhrase, renderReport } from "./report";
import { type FeatureRate, VOICE_DELTA_FEATURES } from "./voice-delta";
import type { VoiceProfile } from "./voice-profile";
import type { WordlistEntry } from "./wordlists";

type ReportInput = Parameters<typeof renderReport>[0];

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
} satisfies ReportInput;

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

const meaningAuditInput: ReportInput = {
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
};

const provenanceInput: ReportInput = { ...baseInput, voiceProfile: fixtureProfile };

const cases: Array<{ name: string; input: ReportInput }> = [
  { name: "empty scaffold", input: baseInput },
  {
    name: "structural trends table",
    input: {
      ...baseInput,
      rateTrends: {
        documentCount: 42,
        meanActionVerbOpenerRate: 0.166,
        meanBacktickRefDensity: 58.3,
        templateDocumentRate: 0.73,
        sectionCountDistribution: { 0: 11, 1: 5, 2: 26 },
        templateOnSmallDocumentCount: 7,
      },
    },
  },
  {
    name: "structural signature rows",
    input: {
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
    },
  },
  { name: "meaning audit", input: meaningAuditInput },
  {
    name: "proposed removals diff block",
    input: {
      ...baseInput,
      ruleHealth: [
        {
          entry: { phrase: "tapestry", source: "vocabulary.txt" } satisfies WordlistEntry,
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
    },
  },
  {
    name: "proposed additions diff block",
    input: {
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
    },
  },
  {
    name: "corrective feedback moments",
    input: {
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
    },
  },
  {
    name: "correction snippets",
    input: {
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
    },
  },
  {
    name: "rule health opener and vocabulary types",
    input: {
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
    },
  },
  {
    name: "voice delta rates only, no baseline",
    input: { ...baseInput, voiceDeltaRates: new Map([rateEntry("first_person_rate", 3.2)]) },
  },
  {
    name: "voice delta corpus, baseline, and delta",
    input: {
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("first_person_rate", 3.2)]),
    },
  },
  {
    name: "voice delta fraction features as percentages",
    input: {
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("template_presence", 0.6)]),
    },
  },
  {
    name: "voice delta feature missing from baseline",
    input: {
      ...baseInput,
      voiceProfile: fixtureProfile,
      voiceDeltaRates: new Map([rateEntry("url_rate", 2.5)]),
    },
  },
  { name: "voice delta full feature table", input: provenanceInput },
];

describe("renderReport", () => {
  test.each(cases)("$name", ({ input }) => {
    expect(renderReport(input)).toMatchSnapshot();
  });

  test("treats a profile without voiceDelta stats as no baseline", () => {
    const { voiceDelta: _omitted, ...legacyProfile } = fixtureProfile;
    expect(renderReport({ ...baseInput, voiceProfile: legacyProfile })).toMatchSnapshot();
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

  test("flattens multi-line meaning-audit spans and omits unflagged criteria", () => {
    const output = renderReport(meaningAuditInput);
    // Multi-line spans are flattened so they cannot break the list item.
    expect(output).toContain('information-density: "These changes ensure correct behavior."');
    // Unflagged criteria contribute no sampled-span line.
    expect(output).not.toContain('sycophancy: "');
  });

  test("labels every voice-delta feature row with its provenance", () => {
    const output = renderReport(provenanceInput);
    const section = output.slice(
      output.indexOf("## Voice Delta"),
      output.indexOf("## Proposed Wordlist Removals"),
    );
    const rows = section
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.includes("--- ") && !l.startsWith("| feature"));
    expect(rows.length).toBe(VOICE_DELTA_FEATURES.length);
    for (const row of rows) {
      expect(row).toMatch(/\| (skill-prescribed|skill-encouraged|ungoverned) \|/);
    }
  });
});
