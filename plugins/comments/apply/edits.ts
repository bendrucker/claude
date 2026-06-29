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
 * Rewrite a file by trimming the slop comments. Builds a deletion mask plus
 * per-line replacements over `source.split("\n")` and applies them once, never
 * mutating line indices mid-loop. Cases:
 *
 * - full-line comment (whitespace either side) → delete its lines;
 * - trailing line comment after code → strip it, keeping the leading code;
 * - block/docstring with `trimToLines` → keep those comment-relative lines;
 * - anything that would risk broken syntax → skip and flag for manual handling.
 *
 * Overlapping verdicts on one line resolve with deletion winning over a replace.
 * Non-slop verdicts are ignored.
 */
export function computeFileEdits(source: string, items: EditItem[]): FileEditResult {
  const lines = source.split("\n");
  const deletions = new Set<number>();
  const replacements = new Map<number, string>();
  const skips: EditSkip[] = [];

  for (const item of items) {
    if (!item.verdict.isSlop) continue;
    const keep = keepLines(item);
    if (keep != null) {
      applyTrim(item, keep, deletions, skips);
    } else {
      applyFull(item, lines, deletions, replacements, skips);
    }
  }

  const out: string[] = [];
  for (let n = 1; n <= lines.length; n++) {
    if (deletions.has(n)) continue;
    out.push(replacements.has(n) ? (replacements.get(n) as string) : (lines[n - 1] as string));
  }
  return { content: out.join("\n"), skips };
}
