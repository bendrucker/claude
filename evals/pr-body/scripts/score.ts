#!/usr/bin/env bun
import { cli } from "cleye";
import { headingCaseViolations } from "../../../plugins/pull-request/scripts/heading-case";
import {
  countProseWords,
  headingTexts,
  linesOutsideFences,
  stripEmphasis,
} from "../../../plugins/pull-request/scripts/markdown";
import {
  COMMA_SPLICE_MIN_CHARS,
  COMMA_SPLICE_MIN_COMMAS,
  hasClauseStacking,
  MAX_SENTENCES_PER_PARAGRAPH,
  NARRATION_TELLS,
  type NarrationTell,
  narrationTellSource,
  proseParagraphs,
  RUN_ON_CHARS,
  type SentenceHeading,
  splitSentences,
  TITLE_LENGTH_LIMIT,
} from "../../../plugins/pull-request/scripts/validate-body";
import { classifyPrHeading } from "../classifier";

// Deterministic metrics for one generated PR body. Everything here is
// mechanical: the LLM judge scores the rest. The thresholds, splitters, and
// wordlists come from the hook that enforces them, so the scorer and the hook
// measure the same thing.

export type { NarrationTell, SentenceHeading };

export interface HeadingCaseViolation {
  text: string;
  suggested: string;
}

export interface TitleMetrics {
  text: string;
  length: number;
  over50: boolean;
  clauseStacking: boolean;
}

export interface ScoreRow {
  wordCount: number;
  headingCaseViolations: number;
  headingCaseDetail: HeadingCaseViolation[];
  sentenceHeadings: number;
  sentenceHeadingDetail: SentenceHeading[];
  longSentences: number;
  longSentenceDetail: string[];
  longParagraphs: number;
  narrationTells: number;
  narrationTellCounts: Record<string, number>;
  title: TitleMetrics | null;
}

export interface ScoreOptions {
  /** Override the heading classifier, so tests can pin its behavior. */
  classify?: (heading: string) => { flagged: boolean; signals: string[] };
}

function isLongSentence(sentence: string): boolean {
  if (sentence.length > RUN_ON_CHARS) return true;
  const commas = (sentence.match(/,/g) ?? []).length;
  return commas >= COMMA_SPLICE_MIN_COMMAS && sentence.length > COMMA_SPLICE_MIN_CHARS;
}

export function countNarrationTells(body: string): Record<string, number> {
  const prose = linesOutsideFences(body).join("\n");
  return Object.fromEntries(
    NARRATION_TELLS.map((tell) => {
      const pattern = new RegExp(narrationTellSource(tell), "gi");
      return [tell, (prose.match(pattern) ?? []).length];
    }),
  );
}

export function scoreTitle(title: string): TitleMetrics {
  return {
    text: title,
    length: title.length,
    over50: title.length > TITLE_LENGTH_LIMIT,
    clauseStacking: hasClauseStacking(title),
  };
}

export function scoreBody(body: string, title?: string, options: ScoreOptions = {}): ScoreRow {
  const classify = options.classify ?? classifyPrHeading;

  const headingCaseDetail = headingCaseViolations(body);

  const sentenceHeadingDetail: SentenceHeading[] = [];
  for (const heading of headingTexts(body)) {
    const result = classify(stripEmphasis(heading));
    if (result.flagged) sentenceHeadingDetail.push({ text: heading, signals: result.signals });
  }

  const paragraphs = proseParagraphs(body).map(splitSentences);
  const longSentenceDetail = paragraphs.flat().filter(isLongSentence);
  const longParagraphs = paragraphs.filter(
    (sentences) => sentences.length > MAX_SENTENCES_PER_PARAGRAPH,
  ).length;

  const narrationTellCounts = countNarrationTells(body);
  const narrationTells = Object.values(narrationTellCounts).reduce((sum, n) => sum + n, 0);

  return {
    wordCount: countProseWords(body),
    headingCaseViolations: headingCaseDetail.length,
    headingCaseDetail,
    sentenceHeadings: sentenceHeadingDetail.length,
    sentenceHeadingDetail,
    longSentences: longSentenceDetail.length,
    longSentenceDetail,
    longParagraphs,
    narrationTells,
    narrationTellCounts,
    title: title === undefined ? null : scoreTitle(title),
  };
}

function report(row: ScoreRow): string {
  const lines = [`words: ${row.wordCount}`];

  if (row.title) {
    const flags = [row.title.over50 ? "over 50" : null, row.title.clauseStacking ? "stacked" : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`title: ${row.title.length} chars${flags ? ` (${flags})` : ""} · ${row.title.text}`);
  }

  lines.push(`heading case violations: ${row.headingCaseViolations}`);
  for (const violation of row.headingCaseDetail) {
    lines.push(`  "${violation.text}" → "${violation.suggested}"`);
  }

  lines.push(`sentence headings: ${row.sentenceHeadings}`);
  for (const heading of row.sentenceHeadingDetail) {
    lines.push(`  "${heading.text}" · ${heading.signals.join("; ")}`);
  }

  lines.push(`long sentences: ${row.longSentences}`);
  for (const sentence of row.longSentenceDetail) {
    lines.push(`  ${sentence.slice(0, 100)}…`);
  }

  lines.push(`long paragraphs: ${row.longParagraphs}`);

  lines.push(`narration tells: ${row.narrationTells}`);
  for (const [tell, count] of Object.entries(row.narrationTellCounts)) {
    if (count > 0) lines.push(`  ${tell}: ${count}`);
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "score",
    parameters: ["<file>"],
    help: { description: "Score one PR body on the deterministic pr-body metrics." },
    flags: {
      title: { type: String, description: "PR title to score alongside the body" },
      json: { type: Boolean, default: false, description: "Emit the raw score row as JSON" },
    },
  });

  const body = await Bun.file(argv._.file).text();
  const row = scoreBody(body, argv.flags.title);
  console.log(argv.flags.json ? JSON.stringify(row) : report(row));
}
