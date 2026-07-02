import type { Verdict } from "../judge/schema";

/** ANSI colors (0-15) remap under the terminal theme, so they adapt to light/dark. */
export const color = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

/** One flagged comment to render: location, the judge's verdict, and its text. */
export interface ReportItem {
  path: string;
  startLine: number;
  verdict: Verdict;
  /** The original comment text, for rendering a rewrite's old → new preview. */
  text?: string;
}

/** The first line of a possibly multi-line comment, for a one-line preview. */
function firstLine(text: string): string {
  return text.split("\n")[0] as string;
}

/**
 * Render the flagged comments grouped by file as `path:line  action  category
 * confidence  rationale`. A `rewrite` shows its old → new preview; with `fix`, a
 * suggestion and any keep-lines follow. `keep` items are dropped.
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
        `  ${color.dim(`:${startLine}`)}  ${verdict.action}  ${verdict.category}  ${conf}`,
      );
      lines.push(`      ${verdict.rationale}`);
      if (verdict.action === "rewrite" && verdict.rewrite) {
        if (text) lines.push(color.dim(`      old: ${firstLine(text)}`));
        lines.push(color.dim(`      new: ${firstLine(verdict.rewrite)}`));
      }
      if (options.fix && verdict.suggestedFix) {
        lines.push(color.dim(`      fix: ${verdict.suggestedFix}`));
      }
      if (verdict.trimToLines?.length) {
        lines.push(color.dim(`      keep lines: ${verdict.trimToLines.join(", ")}`));
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}
