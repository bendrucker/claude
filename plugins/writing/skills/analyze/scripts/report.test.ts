import { describe, expect, test } from "bun:test";
import type { CorrectionRow, CorrectiveRow, ModelSummaryRow } from "./dump";
import { type CandidatePhrase, renderReport } from "./report";
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
  rateTrends: {
    documentCount: 0,
    meanActionVerbOpenerRate: 0,
    meanBacktickRefDensity: 0,
    templateDocumentRate: 0,
    sectionCountDistribution: {},
    templateOnSmallDocumentCount: 0,
  },
  candidatePhrases: [] as CandidatePhrase[],
  corrections: [] as CorrectionRow[],
  corrective: [] as CorrectiveRow[],
};

describe("renderReport", () => {
  test("includes header, summary, and section titles even when empty", () => {
    const output = renderReport(baseInput);
    expect(output).toContain("# Writing trope analysis");
    expect(output).toContain("## Summary");
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
