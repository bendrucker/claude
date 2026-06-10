import { stripCode } from "../../../detection/tropes";

// Rate detectors measure per-document density rather than binary presence.
// They are batch-only (analyze/review surfaces), never promoted to the hook
// without an explicit cross-project validation pass.
//
// Evidence cites the 2026-06 corpus comparison aggregates from issue #788.
// All thresholds were derived from a single-repo AI-era corpus.
// Cross-project validation is required before hook promotion.

// ACTION_VERB_OPENER matches lines that begin with a bare third-person present
// verb, the pattern that fills AI-era bulleted change lists. The first line of
// a document is always skipped because pull-request:create prescribes exactly
// this opener form for the opening summary sentence; the detector targets rate
// stacking across subsequent lines.
//
// Layer: grammar. Batch-only.
// Evidence: 2026-06 corpus: 16.6% of AI-era lines vs 2.4% of hand-written baseline.
const ACTION_VERB_OPENER =
  /^(?:Adds|Removes|Extracts|Fixes|Updates|Changes|Refactors|Introduces|Replaces|Moves|Renames|Converts|Extends|Improves|Simplifies|Drops|Exposes|Wraps|Migrates|Handles|Enables|Disables|Cleans|Deletes|Creates|Generates|Validates|Returns|Allows|Prevents|Ensures|Sets|Gets|Reads|Writes)\b/;

// BACKTICK_REF matches inline code spans. Density above ~60/1k words signals
// over-reliance on technical identifiers as structural substitutes for prose.
// Reported as a continuous metric, never a binary flag.
//
// Layer: cross-sentence. Batch-only.
// Evidence: 2026-06 corpus: backtick reference density ~60/1k words threshold.
const BACKTICK_REF = /`[^`\n]+`/g;

// HEADING_RE matches markdown `##`-level section headings (PR body sections).
const HEADING_RE = /^##\s+\S/m;

// TEMPLATE_SECTIONS are the canonical section headings from pull-request:create.
const TEMPLATE_SECTIONS = ["## Changes", "## Testing", "## Issue", "## References"];

// TEMPLATE_ON_SMALL_DOC_THRESHOLD matches pull-request:create's own rule:
// "Use ## sections for larger changes. Length tracks substance." A body under
// ~150 words with both ## Changes and ## Testing present violates that rule.
const TEMPLATE_ON_SMALL_DOC_THRESHOLD = 150;
const HAS_CHANGES_RE = /^##\s+Changes\b/m;
const HAS_TESTING_RE = /^##\s+Testing\b/m;

export interface DocumentRateRow {
  session_id: string;
  /** Word count after stripping code blocks. */
  wordCount: number;
  /** Fraction of non-first lines that open with a bare action verb (0–1). */
  actionVerbOpenerRate: number;
  /** Inline backtick references per 1,000 words. */
  backtickRefDensity: number;
  /** Whether the document contains at least one ## section heading. */
  hasTemplateSections: boolean;
  /** Number of canonical template sections present (max 4). */
  templateSectionCount: number;
  /**
   * True when both ## Changes and ## Testing are present on a document under
   * the word-count threshold. pull-request:create scopes sections to larger
   * changes; this flags over-structured short bodies.
   */
  templateOnSmallDocument: boolean;
}

export interface CorpusRateTrends {
  /** Number of documents analyzed. */
  documentCount: number;
  /** Mean action-verb opener rate across documents (0–1). */
  meanActionVerbOpenerRate: number;
  /** Mean backtick reference density across documents (per 1k words). */
  meanBacktickRefDensity: number;
  /** Fraction of documents with at least one ## heading. */
  templateDocumentRate: number;
  /** Distribution of canonical section counts (0–4 keys). */
  sectionCountDistribution: Record<number, number>;
  /** Number of documents with full section template on a small body (<150 words). */
  templateOnSmallDocumentCount: number;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countBacktickRefs(text: string): number {
  BACKTICK_REF.lastIndex = 0;
  return text.match(BACKTICK_REF)?.length ?? 0;
}

function actionVerbOpenerRate(text: string): number {
  // Skip blank lines (produced by stripCode fenced-block replacement and normal spacing).
  const lines = text
    .split("\n")
    .slice(1)
    .filter((line) => line.trimStart().length > 0);
  if (lines.length === 0) return 0;
  const openerLines = lines.filter((line) => ACTION_VERB_OPENER.test(line.trimStart()));
  return openerLines.length / lines.length;
}

function templateSectionCount(text: string): number {
  return TEMPLATE_SECTIONS.filter((s) => text.includes(s)).length;
}

export function analyzeDocument(session_id: string, rawText: string): DocumentRateRow {
  const stripped = stripCode(rawText);
  const wordCount = countWords(stripped);
  const backtickCount = countBacktickRefs(rawText);
  const sectionCount = templateSectionCount(rawText);
  const isSmall = wordCount < TEMPLATE_ON_SMALL_DOC_THRESHOLD;
  return {
    session_id,
    wordCount,
    actionVerbOpenerRate: actionVerbOpenerRate(stripped),
    backtickRefDensity: wordCount > 0 ? (backtickCount / wordCount) * 1000 : 0,
    hasTemplateSections: HEADING_RE.test(rawText),
    templateSectionCount: sectionCount,
    templateOnSmallDocument:
      isSmall && HAS_CHANGES_RE.test(rawText) && HAS_TESTING_RE.test(rawText),
  };
}

export function aggregateTrends(rows: DocumentRateRow[]): CorpusRateTrends {
  if (rows.length === 0) {
    return {
      documentCount: 0,
      meanActionVerbOpenerRate: 0,
      meanBacktickRefDensity: 0,
      templateDocumentRate: 0,
      sectionCountDistribution: {},
      templateOnSmallDocumentCount: 0,
    };
  }

  const totalActionVerb = rows.reduce((sum, r) => sum + r.actionVerbOpenerRate, 0);
  const totalBacktick = rows.reduce((sum, r) => sum + r.backtickRefDensity, 0);
  const templateDocs = rows.filter((r) => r.hasTemplateSections).length;
  const templateOnSmall = rows.filter((r) => r.templateOnSmallDocument).length;

  const dist: Record<number, number> = {};
  for (const r of rows) {
    dist[r.templateSectionCount] = (dist[r.templateSectionCount] ?? 0) + 1;
  }

  return {
    documentCount: rows.length,
    meanActionVerbOpenerRate: totalActionVerb / rows.length,
    meanBacktickRefDensity: totalBacktick / rows.length,
    templateDocumentRate: templateDocs / rows.length,
    sectionCountDistribution: dist,
    templateOnSmallDocumentCount: templateOnSmall,
  };
}
