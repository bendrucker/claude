#!/usr/bin/env bun
import { cli } from "cleye";
import { headingCaseViolations } from "../../../plugins/pull-request/scripts/heading-case";
import { classifyPrHeading } from "../classifier";

// Deterministic metrics for one generated PR body. Everything here is
// mechanical: the LLM judge scores the rest.

// Thresholds copied from plugins/pull-request/scripts/validate-body.ts
// (RUN_ON_CHARS, COMMA_SPLICE_MIN_COMMAS, COMMA_SPLICE_MIN_CHARS), which does
// not export them.
const RUN_ON_CHARS = 280;
const COMMA_SPLICE_MIN_COMMAS = 3;
const COMMA_SPLICE_MIN_CHARS = 220;

const TITLE_LENGTH_LIMIT = 50;

export const NARRATION_TELLS = [
  "deliberately",
  "on purpose",
  "worth noting",
  "worth naming",
  "worth knowing",
  "non-obvious",
  "left alone",
  "leaves alone",
] as const;

export type NarrationTell = (typeof NARRATION_TELLS)[number];

export interface HeadingCaseViolation {
  text: string;
  suggested: string;
}

export interface SentenceHeading {
  text: string;
  signals: string[];
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
  narrationTells: number;
  narrationTellCounts: Record<NarrationTell, number>;
  title: TitleMetrics | null;
}

export interface ScoreOptions {
  /** Override the heading classifier, so tests can pin its behavior. */
  classify?: (heading: string) => { flagged: boolean; signals: string[] };
}

const FENCE_PATTERN = /^\s*(```|~~~)/;

function linesOutsideFences(body: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const match = line.match(FENCE_PATTERN);
    if (match?.[1]) {
      fence = fence === null ? match[1] : fence === match[1] ? null : fence;
      continue;
    }
    if (fence === null) lines.push(line);
  }
  return lines;
}

function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/(?<![\w`])__(.+?)__(?![\w`])/g, "$1")
    .replace(/(?<![\w`])_(.+?)_(?![\w`])/g, "$1");
}

export function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of linesOutsideFences(body)) {
    const match = line.match(/^#{2,6}\s+(.+)$/);
    if (match?.[1]) headings.push(match[1].trim());
  }
  return headings;
}

// Prose paragraphs: fenced code, headings, list items, tables, and blockquotes
// drop out, so sentence density is measured on prose alone.
function proseParagraphs(body: string): string[] {
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const joined = buffer.join(" ").trim();
    if (joined.length > 0) paragraphs.push(joined);
    buffer = [];
  };
  for (const line of linesOutsideFences(body)) {
    if (line.trim() === "" || /^\s*(#{1,6}\s|[-*]\s|\d+[.)]\s|\||>)/.test(line)) {
      flush();
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return paragraphs;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`(])/).filter((sentence) => sentence.trim().length > 0);
}

function isLongSentence(sentence: string): boolean {
  if (sentence.length > RUN_ON_CHARS) return true;
  const commas = (sentence.match(/,/g) ?? []).length;
  return commas >= COMMA_SPLICE_MIN_COMMAS && sentence.length > COMMA_SPLICE_MIN_CHARS;
}

export function countProseWords(body: string): number {
  return linesOutsideFences(body)
    .join(" ")
    .split(/\s+/)
    .filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

export function countNarrationTells(body: string): Record<NarrationTell, number> {
  const prose = linesOutsideFences(body).join("\n");
  const counts = {} as Record<NarrationTell, number>;
  for (const tell of NARRATION_TELLS) {
    const pattern = new RegExp(`\\b${tell.replace(/ /g, "\\s+")}\\b`, "gi");
    counts[tell] = (prose.match(pattern) ?? []).length;
  }
  return counts;
}

// A comma before a coordinating conjunction, two or more commas, or a colon
// followed by a comma: all three stack clauses onto a title that should carry
// one.
export function hasClauseStacking(title: string): boolean {
  if (/,\s*(?:and|or|but|nor|for|so|yet)\b/i.test(title)) return true;
  if ((title.match(/,/g) ?? []).length >= 2) return true;
  return /:[^,]*,/.test(title);
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
  for (const heading of extractHeadings(body)) {
    const result = classify(stripEmphasis(heading));
    if (result.flagged) sentenceHeadingDetail.push({ text: heading, signals: result.signals });
  }

  const longSentenceDetail = proseParagraphs(body).flatMap(splitSentences).filter(isLongSentence);

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
