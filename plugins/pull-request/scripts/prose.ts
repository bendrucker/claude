// Prose measurements the body rules enforce and the eval scorer reports, so
// both read the same thresholds, splitters, and wordlists.

import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { linesOutsideFences } from "./markdown";

// Prose density thresholds. A paragraph past MAX_SENTENCES_PER_PARAGRAPH runs
// more than one thread. A sentence past RUN_ON_CHARS is a wall. A sentence with
// COMMA_SPLICE_MIN_COMMAS commas past COMMA_SPLICE_MIN_CHARS is an enumeration
// that belongs in a list.
export const RUN_ON_CHARS = 280;
export const COMMA_SPLICE_MIN_COMMAS = 3;
export const COMMA_SPLICE_MIN_CHARS = 220;
export const MAX_SENTENCES_PER_PARAGRAPH = 4;

// Join the body into prose paragraphs, dropping fenced code, tables, headings,
// list items, and blockquotes so density is measured on prose alone. Fence
// tracking lives in `linesOutsideFences`, which yields a blank line per fenced
// block so the paragraphs around it stay separate.
export function proseParagraphs(body: string): string[] {
  const paras: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) paras.push(buf.join(" ").trim());
    buf = [];
  };
  for (const line of linesOutsideFences(body)) {
    if (line.trim() === "" || /^\s*(#{1,6}\s|[-*]\s|\d+[.)]\s|\||>)/.test(line)) {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  return paras.filter((p) => p.length > 0);
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`(])/).filter((s) => s.trim().length > 0);
}

// A PR body renders in a web UI that soft-wraps, so hard-wrapping prose at a
// column only narrows it. The floor excludes deliberate one-entry-per-line
// blocks (a list of SHAs, a signature), which sit well under any fill column.
// The ceiling keeps a genuinely long line from reading as a wrap.
export const WRAP_MIN_LINE = 50;
export const WRAP_MAX_LINE = 100;

// `fromMarkdown` runs without the GFM extension, so a table parses as one
// multi-line paragraph. Skipping one costs two shapes, where the extension
// costs a dependency tree on a hook that runs on every `gh pr create`. Leading
// pipes are optional in GFM, so a row check alone misses a pipe-less table
// whose delimiter row is padded out to the column width.
const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^[\s:|-]+$/;

function isTableParagraph(lines: string[]): boolean {
  if (lines.every((line) => TABLE_ROW.test(line))) return true;
  // A delimiter row separates columns with a pipe and pads with dashes. Prose
  // never produces a line built from nothing else.
  return lines.some(
    (line) => TABLE_DELIMITER.test(line) && line.includes("|") && line.includes("-"),
  );
}

/**
 * Every paragraph under a blockquote, at any depth. Quoted text reproduces
 * someone else's line breaks, so reflowing it edits the quotation. Under lazy
 * continuation only the opening line carries a `>`, which puts the answer in the
 * tree rather than in the text a line test could read.
 */
function quotedParagraphs(tree: Nodes): Set<Nodes> {
  const quoted = new Set<Nodes>();
  visit(tree, "blockquote", (blockquote) => {
    visit(blockquote, "paragraph", (paragraph) => {
      quoted.add(paragraph);
    });
  });
  return quoted;
}

export interface WrappedParagraph {
  /** The paragraph exactly as it appears in the body. */
  raw: string;
  /** The same paragraph on one line. */
  unwrapped: string;
  /** Byte offsets of `raw` within the body. */
  start: number;
  end: number;
}

/**
 * Paragraphs hard-wrapped at a fill column. mdast supplies the block structure,
 * so fenced code, list continuations, nested lists, indented code, and HTML need
 * no handling here. A `break` child is a two-space markdown hard break, which is
 * an explicit line break rather than a wrap.
 */
export function hardWrappedParagraphs(body: string): WrappedParagraph[] {
  const found: WrappedParagraph[] = [];
  const tree = fromMarkdown(body);
  const quoted = quotedParagraphs(tree);
  visit(tree, "paragraph", (node) => {
    if (quoted.has(node)) return;
    const { start, end } = node.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined) return;
    if (start.line === end.line) return;
    if (node.children.some((child) => child.type === "break")) return;
    const raw = body.slice(start.offset, end.offset);
    const lines = raw.split("\n");
    if (isTableParagraph(lines)) return;
    const heads = lines.slice(0, -1).map((line) => line.trim().length);
    if (!heads.every((length) => length >= WRAP_MIN_LINE && length <= WRAP_MAX_LINE)) return;
    found.push({
      raw,
      // Consuming the whitespace on both sides of the break keeps a line that
      // ended in a space from joining as two, and drops the CR of a CRLF body.
      unwrapped: raw.replace(/[ \t]*\r?\n[ \t]*/g, " "),
      start: start.offset,
      end: end.offset,
    });
  });
  return found;
}

/**
 * Rewrite every hard-wrapped paragraph onto one line, leaving the rest of the
 * body byte-identical. Splicing runs back to front so each offset stays valid.
 */
export function unwrapBody(body: string): string {
  let out = body;
  for (const { unwrapped, start, end } of hardWrappedParagraphs(body).toReversed()) {
    out = out.slice(0, start) + unwrapped + out.slice(end);
  }
  return out;
}

// Vocabulary that leaks the instructions into the output: the body claims a
// choice was made on purpose, or that a fact is worth the reader's attention.
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

/** Regex source for one tell, shared with the eval scorer so both match identically. */
export function narrationTellSource(tell: string): string {
  return `\\b${tell.replace(/ /g, "\\s+")}\\b`;
}

export const TITLE_LENGTH_LIMIT = 50;

// Each pattern stacks clauses onto a title that should carry one.
export function hasClauseStacking(title: string): boolean {
  if (/,\s*(?:and|or|but|nor|for|so|yet)\b/i.test(title)) return true;
  if ((title.match(/,/g) ?? []).length >= 2) return true;
  return /:[^,]*,/.test(title);
}
