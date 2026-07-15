import type { CommentKind } from "../detection/types";
import type { Verdict } from "../judge/schema";

/** One comment's range plus the verdict that decides how it is trimmed. */
export interface EditItem {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  kind: CommentKind;
  verdict: Verdict;
}

/** A comment the applier refused to touch, left for a human to handle. */
export interface EditSkip {
  startLine: number;
  reason: "manual";
  detail: string;
}

/** A line the applier produced that a human should re-check, not a refusal. */
export interface EditWarning {
  line: number;
  detail: string;
}

export interface FileEditResult {
  content: string;
  skips: EditSkip[];
  warnings: EditWarning[];
}

export interface FileEditOptions {
  /** Applier-produced lines longer than this are flagged in `warnings`. */
  maxWidth?: number;
}

/**
 * Words that continue a sentence rather than start one. A kept line opening
 * with one of these, right after a dropped line that lacks terminal
 * punctuation, is almost certainly a mid-sentence fragment. Sentence-opening
 * prepositions (for, to, from, of, as) are excluded: they routinely start
 * complete sentences ("For each entry, retry once.") and over-fire the guard.
 */
export const SENTENCE_CONNECTIVES = new Set([
  "and",
  "or",
  "but",
  "so",
  "which",
  "that",
  "the",
  "this",
  "these",
  "those",
  "other",
  "others",
  "its",
  "their",
  "instead",
  "rather",
  "with",
  "without",
  "because",
  "since",
  "while",
  "when",
  "where",
]);

/** A line's prose: leading/trailing comment markers and whitespace stripped. */
function stripCommentMarkers(line: string): string {
  return line
    .trim()
    .replace(/^(?:\/\*+|\/\/+|#+|--+|;+|"""|'''|\*+)\s*/, "")
    .replace(/\s*(?:\*+\/|"""|''')$/, "")
    .trim();
}

/**
 * The source lines a `trimToLines` verdict keeps, expressed as 1-based source
 * line numbers. `trimToLines` is comment-relative (line 1 is the comment's first
 * line). Returns null when the comment should be removed whole: no trim, an empty
 * trim, or a trim that lands entirely outside the comment span.
 */
function keepLines(item: EditItem): number[] | null {
  const trim = item.verdict.trimToLines;
  if (!trim || trim.length === 0) return null;
  const span = item.endLine - item.startLine + 1;
  const keep = trim
    .filter((k) => Number.isInteger(k) && k >= 1 && k <= span)
    .map((k) => item.startLine + k - 1);
  return keep.length === 0 ? null : keep;
}

/**
 * True when a line-range trim would keep a line that continues a sentence begun
 * on a dropped line: the dropped boundary line does not end a sentence and the
 * kept line opens with a connective word. `trimToLines` cannot express the
 * needed mid-line cut, so the trim must go to a human (or a `trimTo` verdict).
 */
function strandsFragment(item: EditItem, kept: Set<number>, lines: string[]): boolean {
  for (const n of kept) {
    if (n <= item.startLine || kept.has(n - 1)) continue;
    const dropped = stripCommentMarkers(lines[n - 2] ?? "");
    if (/[.!?:]$/.test(dropped)) continue;
    // Match letters only, so a connective with trailing punctuation ("that,")
    // still resolves to its word.
    const firstWord = stripCommentMarkers(lines[n - 1] ?? "")
      .match(/^[A-Za-z']+/)?.[0]
      ?.toLowerCase();
    if (firstWord && SENTENCE_CONNECTIVES.has(firstWord)) return true;
  }
  return false;
}

function applyTrim(
  item: EditItem,
  keep: number[],
  lines: string[],
  deletions: Set<number>,
  skips: EditSkip[],
): void {
  const kept = new Set(keep);
  if (
    (item.kind === "block" || item.kind === "docstring") &&
    (!kept.has(item.startLine) || !kept.has(item.endLine))
  ) {
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail: "trim would drop the opening or closing delimiter of a block comment",
    });
    return;
  }
  if (strandsFragment(item, kept, lines)) {
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail:
        "partial trim would keep a mid-sentence fragment (sentence starts mid-line on a dropped line); rewrite by hand",
    });
    return;
  }
  for (let n = item.startLine; n <= item.endLine; n++) {
    if (!kept.has(n)) deletions.add(n);
  }
}

function applyFull(
  item: EditItem,
  lines: string[],
  deletions: Set<number>,
  replacements: Map<number, string>,
  skips: EditSkip[],
): void {
  const before = (lines[item.startLine - 1] ?? "").slice(0, item.startColumn);
  const after = (lines[item.endLine - 1] ?? "").slice(item.endColumn);
  const wsBefore = before.trim().length === 0;
  const wsAfter = after.trim().length === 0;

  if (wsBefore && wsAfter) {
    for (let n = item.startLine; n <= item.endLine; n++) deletions.add(n);
    return;
  }

  if (!wsBefore && wsAfter && item.kind === "line" && item.startLine === item.endLine) {
    replacements.set(item.startLine, before.replace(/\s+$/, ""));
    return;
  }

  skips.push({
    startLine: item.startLine,
    reason: "manual",
    detail: "comment is interleaved with code on its line",
  });
}

/**
 * Replace a comment's span with judge-authored text (a `rewrite` or a partial
 * trim's `trimTo`). The text carries the delimiters but no leading indentation;
 * the applier owns it. For a full-line comment the span's lines become the
 * indented text lines. For a trailing line comment the text is spliced after
 * the code, one space apart. Anything else (a trailing block, code interleaved
 * on the line) is skipped and flagged, the same conservative bar trims use.
 */
function replaceSpan(
  item: EditItem,
  text: string,
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
  skips: EditSkip[],
): void {
  const before = (lines[item.startLine - 1] ?? "").slice(0, item.startColumn);
  const after = (lines[item.endLine - 1] ?? "").slice(item.endColumn);
  const wsBefore = before.trim().length === 0;
  const wsAfter = after.trim().length === 0;
  const textLines = text.split("\n");

  if (wsBefore && wsAfter) {
    const indent = before;
    spanInserts.set(
      item.startLine,
      textLines.map((line) => `${indent}${line}`.replace(/\s+$/, "")),
    );
    for (let n = item.startLine; n <= item.endLine; n++) deletions.add(n);
    return;
  }

  if (!wsBefore && wsAfter && item.kind === "line" && item.startLine === item.endLine) {
    const code = before.replace(/\s+$/, "");
    spanInserts.set(item.startLine, [`${code} ${textLines.join(" ")}`.replace(/\s+$/, "")]);
    deletions.add(item.startLine);
    return;
  }

  skips.push({
    startLine: item.startLine,
    reason: "manual",
    detail: "comment is interleaved with code on its line",
  });
}

function applyRewrite(
  item: EditItem,
  lines: string[],
  deletions: Set<number>,
  spanInserts: Map<number, string[]>,
  skips: EditSkip[],
): void {
  const rewrite = item.verdict.rewrite;
  if (!rewrite) {
    skips.push({
      startLine: item.startLine,
      reason: "manual",
      detail: "rewrite verdict carried no rewrite text",
    });
    return;
  }
  replaceSpan(item, rewrite, lines, deletions, spanInserts, skips);
}

/**
 * Rewrite a file by acting on each comment's verdict. Builds a deletion mask,
 * per-line replacements, and span inserts over `source.split("\n")`, then applies
 * them once, never mutating line indices mid-loop. By action:
 *
 * - `keep` → left untouched;
 * - `trim` with `trimTo` → replace the comment span with the kept, rewritten text;
 * - `trim` with `trimToLines` → keep those comment-relative lines, drop the rest,
 *   unless the cut would strand a mid-sentence fragment (skipped for a human);
 * - `trim` whole, full-line comment → delete its lines;
 * - `trim` whole, trailing line comment after code → strip it, keep the code;
 * - `rewrite` → replace the comment span with the indented de-voiced text;
 * - anything that would risk broken syntax → skip and flag for manual handling.
 *
 * Overlapping verdicts on one line resolve with deletion winning over a replace.
 * A span insert at a line takes precedence over its own span's deletions.
 * Applier-produced lines longer than `maxWidth` are flagged in `warnings`.
 */
export function computeFileEdits(
  source: string,
  items: EditItem[],
  options: FileEditOptions = {},
): FileEditResult {
  const { maxWidth = 100 } = options;
  const lines = source.split("\n");
  const deletions = new Set<number>();
  const replacements = new Map<number, string>();
  const spanInserts = new Map<number, string[]>();
  const skips: EditSkip[] = [];
  const warnings: EditWarning[] = [];

  for (const item of items) {
    switch (item.verdict.action) {
      case "keep":
        break;
      case "trim": {
        if (item.verdict.trimTo) {
          replaceSpan(item, item.verdict.trimTo, lines, deletions, spanInserts, skips);
          break;
        }
        const keep = keepLines(item);
        if (keep != null) {
          applyTrim(item, keep, lines, deletions, skips);
        } else {
          applyFull(item, lines, deletions, replacements, skips);
        }
        break;
      }
      case "rewrite":
        applyRewrite(item, lines, deletions, spanInserts, skips);
        break;
    }
  }

  for (const [n, insert] of spanInserts) {
    for (const line of insert) {
      if (line.length > maxWidth) {
        warnings.push({
          line: n,
          detail: `applier produced a ${line.length}-character line (over ${maxWidth}); re-wrap by hand`,
        });
      }
    }
  }

  const isBlank = (line: string): boolean => line.trim().length === 0;
  const out: string[] = [];
  let lastPushed = "";
  let lastPushedBlank = false;
  for (let n = 1; n <= lines.length; n++) {
    const insert = spanInserts.get(n);
    if (insert) {
      if (insert.length > 0) {
        for (const line of insert) out.push(line);
        lastPushed = insert[insert.length - 1] as string;
        lastPushedBlank = isBlank(lastPushed);
      }
      continue;
    }
    if (deletions.has(n)) continue;
    const line = replacements.has(n) ? (replacements.get(n) as string) : (lines[n - 1] as string);
    // A trim can leave a surviving blank line next to a blank we already kept,
    // collapsing `blank / deleted comment / blank` into a double blank. Drop it,
    // but only when a neighbor was deleted, so unrelated blank runs are untouched.
    if (isBlank(line) && lastPushedBlank && (deletions.has(n - 1) || deletions.has(n + 1))) {
      continue;
    }
    // Deleting a docstring directly under a `def f():` or `{` opener can leave a
    // blank as the block's first line. Drop a blank right after a deleted span
    // when the surviving line above the span opens a block.
    if (isBlank(line) && deletions.has(n - 1) && /[:{]$/.test(lastPushed.trimEnd())) {
      continue;
    }
    out.push(line);
    lastPushed = line;
    lastPushedBlank = isBlank(line);
  }
  return { content: out.join("\n"), skips, warnings };
}
