import type { Verdict } from "../judge/schema";

/** ANSI colors (0-15) remap under the terminal theme, so they adapt to light/dark. */
export const color = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
};

/** One flagged comment to render: location, the judge's verdict, and its text. */
export interface ReportItem {
  path: string;
  startLine: number;
  verdict: Verdict;
  /** The original comment text, for rendering a rewrite's old → new preview. */
  text?: string;
  /** True when the applier refused the edit and left it for manual handling. */
  skipped?: boolean;
}

/** The first line of a possibly multi-line comment, for a one-line preview. */
function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

/**
 * A `trim` that keeps nothing (no `trimTo`, no `trimToLines`) removes the whole
 * comment, so it reads as `delete`; a `trim` that keeps part stays `trim`.
 */
function actionLabel(verdict: Verdict): string {
  if (verdict.action !== "trim") return verdict.action;
  return (verdict.trimTo != null && verdict.trimTo !== "") ||
    (verdict.trimToLines != null && verdict.trimToLines.length !== 0)
    ? "trim"
    : "delete";
}

/**
 * One-line split of the flagged verdicts: `N delete / M trim / K rewrite across
 * F files`. Counts only what the applier will change. Verdicts it refused are
 * appended as `, J to manual handling` so the split reads without the stderr
 * skip list.
 */
export function summarize(items: ReportItem[]): string {
  const flagged = items.filter((item) => item.verdict.action !== "keep");
  const applied = flagged.filter((item) => !item.skipped);
  const count = (label: string) =>
    applied.filter((item) => actionLabel(item.verdict) === label).length;
  const files = new Set(applied.map((item) => item.path)).size;
  const manual = flagged.length - applied.length;
  const split = `${count("delete")} delete / ${count("trim")} trim / ${count("rewrite")} rewrite across ${files} file(s)`;
  return manual > 0 ? `${split}, ${manual} to manual handling` : split;
}

/**
 * Render the flagged comments grouped by file as `path:line  action  category
 * confidence  rationale`, under a delete/trim/rewrite summary line. A `rewrite`
 * shows its old → new preview; a partial trim shows what it keeps; with `fix`,
 * a suggestion follows. `keep` items are dropped.
 */
export function renderReport(items: ReportItem[], options: { fix: boolean }): string {
  const flagged = items.filter((item) => item.verdict.action !== "keep");
  if (flagged.length === 0) return color.dim("No slop comments found.");

  const byFile = new Map<string, ReportItem[]>();
  for (const item of flagged) {
    const list = byFile.get(item.path) ?? [];
    list.push(item);
    byFile.set(item.path, list);
  }

  const blocks: string[] = [];
  for (const [path, group] of byFile) {
    const lines = [color.bold(path)];
    for (const { startLine, verdict, text } of group) {
      const conf =
        verdict.confidence === "high" ? color.red(verdict.confidence) : verdict.confidence;
      lines.push(
        `  ${color.dim(`:${startLine}`)}  ${actionLabel(verdict)}  ${verdict.category}  ${conf}`,
      );
      lines.push(`      ${verdict.rationale}`);
      if (verdict.action === "rewrite" && verdict.rewrite != null && verdict.rewrite !== "") {
        if (text != null && text !== "") lines.push(color.dim(`      old: ${firstLine(text)}`));
        lines.push(color.dim(`      new: ${firstLine(verdict.rewrite)}`));
      }
      if (options.fix && verdict.suggestedFix != null && verdict.suggestedFix !== "") {
        lines.push(color.dim(`      fix: ${verdict.suggestedFix}`));
      }
      if (verdict.trimTo != null && verdict.trimTo !== "") {
        lines.push(color.dim(`      keep: ${firstLine(verdict.trimTo)}`));
      } else if (verdict.trimToLines != null && verdict.trimToLines.length !== 0) {
        lines.push(color.dim(`      keep lines: ${verdict.trimToLines.join(", ")}`));
      }
    }
    blocks.push(lines.join("\n"));
  }
  return [color.bold(summarize(items)), ...blocks].join("\n\n");
}
