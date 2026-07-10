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

export interface FileEditResult {
  content: string;
  skips: EditSkip[];
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

function applyTrim(
  item: EditItem,
  keep: number[],
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
 * Replace a comment's span with the judge's de-voiced rewrite. The rewrite text
 * carries the delimiters but no leading indentation; the applier owns it. For a
 * full-line comment the span's lines become the indented rewrite lines. For a
 * trailing line comment the rewrite is spliced after the code, one space apart.
 * Anything else (a trailing block, code interleaved on the line) is skipped and
 * flagged, the same conservative bar trims use.
 */
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
  const before = (lines[item.startLine - 1] ?? "").slice(0, item.startColumn);
  const after = (lines[item.endLine - 1] ?? "").slice(item.endColumn);
  const wsBefore = before.trim().length === 0;
  const wsAfter = after.trim().length === 0;
  const rewriteLines = rewrite.split("\n");

  if (wsBefore && wsAfter) {
    const indent = before;
    spanInserts.set(
      item.startLine,
      rewriteLines.map((line) => `${indent}${line}`.replace(/\s+$/, "")),
    );
    for (let n = item.startLine; n <= item.endLine; n++) deletions.add(n);
    return;
  }

  if (!wsBefore && wsAfter && item.kind === "line" && item.startLine === item.endLine) {
    const code = before.replace(/\s+$/, "");
    spanInserts.set(item.startLine, [`${code} ${rewriteLines.join(" ")}`.replace(/\s+$/, "")]);
    deletions.add(item.startLine);
    return;
  }

  skips.push({
    startLine: item.startLine,
    reason: "manual",
    detail: "comment is interleaved with code on its line",
  });
}

/**
 * Rewrite a file by acting on each comment's verdict. Builds a deletion mask,
 * per-line replacements, and span inserts over `source.split("\n")`, then applies
 * them once, never mutating line indices mid-loop. By action:
 *
 * - `keep` → left untouched;
 * - `trim` with `trimToLines` → keep those comment-relative lines, drop the rest;
 * - `trim` whole, full-line comment → delete its lines;
 * - `trim` whole, trailing line comment after code → strip it, keep the code;
 * - `rewrite` → replace the comment span with the indented de-voiced text;
 * - anything that would risk broken syntax → skip and flag for manual handling.
 *
 * Overlapping verdicts on one line resolve with deletion winning over a replace.
 * A span insert at a line takes precedence over its own span's deletions.
 */
export function computeFileEdits(source: string, items: EditItem[]): FileEditResult {
  const lines = source.split("\n");
  const deletions = new Set<number>();
  const replacements = new Map<number, string>();
  const spanInserts = new Map<number, string[]>();
  const skips: EditSkip[] = [];

  for (const item of items) {
    switch (item.verdict.action) {
      case "keep":
        break;
      case "trim": {
        const keep = keepLines(item);
        if (keep != null) {
          applyTrim(item, keep, deletions, skips);
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

  const isBlank = (line: string): boolean => line.trim().length === 0;
  const out: string[] = [];
  let lastPushedBlank = false;
  for (let n = 1; n <= lines.length; n++) {
    const insert = spanInserts.get(n);
    if (insert) {
      if (insert.length > 0) {
        for (const line of insert) out.push(line);
        lastPushedBlank = isBlank(insert[insert.length - 1] as string);
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
    out.push(line);
    lastPushedBlank = isBlank(line);
  }
  return { content: out.join("\n"), skips };
}
