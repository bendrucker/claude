import { table } from "table";
import { stripCode } from "../../../detection/code-spans";
import { extractComments } from "../../../detection/comments";
import { isProseFile } from "../../../detection/paths";
import { lintProse } from "../../../detection/vale";

export interface CheckScore {
  check: string;
  hits: number;
  density: number;
}

export interface GroupScore {
  group: string;
  wordCount: number;
  checks: CheckScore[];
}

export interface ScoreReport {
  filePath: string | undefined;
  groups: GroupScore[];
}

export interface ReportOptions {
  comments: boolean;
}

function countWords(text: string): number {
  return text.match(/[a-zA-Z]+/g)?.length ?? 0;
}

function density(hits: number, wordCount: number): number {
  if (wordCount === 0) return 0;
  return hits / (wordCount / 1000);
}

async function checkScores(
  text: string,
  filePath: string | undefined,
  wordCount: number,
): Promise<CheckScore[]> {
  const counts = new Map<string, number>();
  for (const alert of await lintProse(text, filePath)) {
    counts.set(alert.Check, (counts.get(alert.Check) ?? 0) + 1);
  }
  return [...counts.entries()].map(([check, hits]) => ({
    check,
    hits,
    density: density(hits, wordCount),
  }));
}

export async function scoreText(text: string, filePath: string | undefined): Promise<GroupScore> {
  const wordCount = countWords(stripCode(text));
  const checks = await checkScores(text, filePath, wordCount);
  return { group: "prose", wordCount, checks };
}

export async function scoreComments(
  text: string,
  filePath: string,
): Promise<GroupScore | undefined> {
  const comments = await extractComments(text, filePath);
  if (comments.trim().length === 0) return undefined;
  // Score comments as prose so prose-only patterns apply to them.
  return { ...(await scoreText(comments, undefined)), group: "comments" };
}

// Whether to extract and score code comments as a separate group. Prose files
// (including `.md`, whose fenced code blocks stripCode already removes) are
// scored whole; non-prose source files get their comments pulled out. Explicit
// flags win: --no-comments forces off, --comments forces on.
export function shouldScoreComments(
  filePath: string | undefined,
  on: boolean | undefined,
  off: boolean,
): boolean {
  if (off) return false;
  if (on) return true;
  if (filePath === undefined) return false;
  return !isProseFile(filePath);
}

export async function buildReport(
  text: string,
  filePath: string | undefined,
  options: ReportOptions,
): Promise<ScoreReport> {
  const groups: GroupScore[] = [await scoreText(text, filePath)];
  if (options.comments && filePath !== undefined) {
    const comments = await scoreComments(text, filePath);
    if (comments) groups.push(comments);
  }
  return { filePath, groups };
}

function formatDensity(value: number): string {
  return value.toFixed(1);
}

export function renderTable(report: ScoreReport): string {
  const sections: string[] = [];
  for (const group of report.groups) {
    const header = `${group.group} (${group.wordCount} words)`;
    const rows = group.checks
      .toSorted((a, b) => {
        const byDensity = b.density - a.density;
        return byDensity !== 0 ? byDensity : a.check.localeCompare(b.check);
      })
      .map((c) => [c.check, String(c.hits), formatDensity(c.density)]);
    if (rows.length === 0) {
      sections.push(`${header}\nNo patterns detected.`);
      continue;
    }
    sections.push(`${header}\n${table([["Check", "Hits", "Density /1k"], ...rows])}`.trimEnd());
  }
  return sections.join("\n\n");
}
