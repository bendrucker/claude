import { table } from "table";
import { type FileCoverage, formatRanges, lineCoverage, uncoveredLines } from "./lcov";

// ANSI colors 0-15 (remapped by the terminal theme). See .claude/rules/scripts.md.
const RESET = "\x1b[0m";
function color(code: number, text: string): string {
  return `\x1b[${code}m${text}${RESET}`;
}

function pctColor(pct: number): (text: string) => string {
  const code = pct >= 90 ? 32 : pct >= 70 ? 33 : 31; // green / yellow / red
  return (text) => color(code, text);
}

function sortByCoverage(reports: FileCoverage[]): FileCoverage[] {
  return reports.toSorted((a, b) => lineCoverage(a).pct - lineCoverage(b).pct);
}

export function terminalReport(reports: FileCoverage[]): string {
  if (reports.length === 0) return "No coverage data.";

  const sorted = sortByCoverage(reports);
  const rows = sorted.map((fc) => {
    const { pct } = lineCoverage(fc);
    const paint = pctColor(pct);
    return [fc.file, paint(`${pct.toFixed(1)}%`), formatRanges(uncoveredLines(fc)) || "—"];
  });

  const summary = table([["File", "% Lines", "Uncovered"], ...rows]);

  const details: string[] = [];
  for (const fc of sorted) {
    const uncovered = uncoveredLines(fc);
    if (uncovered.length === 0) continue;
    details.push(`${color(31, fc.file)}: ${uncovered.join(", ")}`);
  }

  return details.length ? `${summary}\nUncovered lines:\n${details.join("\n")}` : summary.trimEnd();
}

function markdownTable(reports: FileCoverage[]): string {
  const header = "| File | % Lines | Uncovered |\n| --- | --- | --- |";
  const rows = sortByCoverage(reports).map((fc) => {
    const { pct } = lineCoverage(fc);
    return `| \`${fc.file}\` | ${pct.toFixed(1)}% | ${formatRanges(uncoveredLines(fc)) || "—"} |`;
  });
  return [header, ...rows].join("\n");
}

// Markdown summary for the GitHub Actions job summary. Reporting only: no
// per-line annotations, which read as defect-grade warnings and hit GitHub's
// ~10-per-level render cap. Per-line detail lives in the local hook and skill.
export function githubReport(reports: FileCoverage[]): string {
  return reports.length
    ? `## Coverage\n\n${markdownTable(reports)}`
    : "## Coverage\n\nNo coverage data.";
}
