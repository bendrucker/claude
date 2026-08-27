import { table } from "table";
import { extractComments } from "../../../detection/comments";
import { isProseFile } from "../../../detection/paths";
import { scanAll } from "../../../detection/scan";
import { stripCode } from "../../../detection/tropes";
import { compileStemmedWordlist, countWords } from "../../../detection/wordlists";
import { checkRegister, VOICE_DELTA_FEATURES } from "../../analyze/scripts/voice-delta";
import type { VoiceProfile } from "../../analyze/scripts/voice-profile";

export type CategoryScore = { category: string; hits: number; density: number };

export type GroupScore = {
  group: string;
  wordCount: number;
  categories: CategoryScore[];
};

export type ScoreReport = {
  filePath: string | undefined;
  groups: GroupScore[];
};

export type ReportOptions = {
  comments: boolean;
  customMatch?: (text: string) => { count: number };
};

const CUSTOM_VOCABULARY = "custom vocabulary";

function density(hits: number, wordCount: number): number {
  if (wordCount === 0) return 0;
  return hits / (wordCount / 1000);
}

function categoryScores(
  text: string,
  filePath: string | undefined,
  wordCount: number,
): CategoryScore[] {
  const counts = new Map<string, number>();
  for (const result of scanAll(text, filePath)) {
    counts.set(result.category, (counts.get(result.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, hits]) => ({
    category,
    hits,
    density: density(hits, wordCount),
  }));
}

function customVocabularyScore(
  text: string,
  match: (text: string) => { count: number },
  wordCount: number,
): CategoryScore {
  const hits = match(stripCode(text)).count;
  return { category: CUSTOM_VOCABULARY, hits, density: density(hits, wordCount) };
}

export function scoreText(
  text: string,
  filePath: string | undefined,
  customMatch?: (text: string) => { count: number },
): GroupScore {
  const wordCount = countWords(stripCode(text));
  const categories = categoryScores(text, filePath, wordCount);
  if (customMatch) {
    categories.push(customVocabularyScore(text, customMatch, wordCount));
  }
  return { group: "prose", wordCount, categories };
}

export function scoreComments(
  text: string,
  customMatch?: (text: string) => { count: number },
): GroupScore | undefined {
  const comments = extractComments(text);
  if (comments.trim().length === 0) return undefined;
  // Score comments as prose so prose-only patterns apply to them.
  return { ...scoreText(comments, undefined, customMatch), group: "comments" };
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

export function buildReport(
  text: string,
  filePath: string | undefined,
  options: ReportOptions,
): ScoreReport {
  const groups: GroupScore[] = [scoreText(text, filePath, options.customMatch)];
  if (options.comments) {
    const comments = scoreComments(text, options.customMatch);
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
    const rows = group.categories
      .toSorted((a, b) => {
        const byDensity = b.density - a.density;
        return byDensity !== 0 ? byDensity : a.category.localeCompare(b.category);
      })
      .map((c) => [c.category, String(c.hits), formatDensity(c.density)]);
    if (rows.length === 0) {
      sections.push(`${header}\nNo patterns detected.`);
      continue;
    }
    sections.push(`${header}\n${table([["Category", "Hits", "Density /1k"], ...rows])}`.trimEnd());
  }
  return sections.join("\n\n");
}

export async function loadCustomMatch(
  path: string | undefined,
): Promise<((text: string) => { count: number }) | undefined> {
  if (path == null || path === "") return undefined;
  const content = await Bun.file(path).text();
  return compileStemmedWordlist(content);
}

// Render voice-delta features for a single document. Accepts the loaded profile
// (null when not available). Skips baseline comparison when the input is
// out-of-register (too short or non-prose markdown fraction).
export function renderVoiceDeltaTable(text: string, profile: VoiceProfile | null): string {
  const register = checkRegister(text);
  const baseline = profile?.voiceDelta ?? null;

  const lines: string[] = ["Voice Delta Features"];

  if (!register.inRegister) {
    lines.push(`Register check: skipping baseline comparison (${register.reason}).`);
    lines.push("");
  } else if (baseline === null) {
    lines.push("No baseline loaded. Run ingest-voice.ts then voice-profile.ts to build one.");
    lines.push("");
  }

  const hasBaseline = baseline !== null && register.inRegister;

  const headers = hasBaseline
    ? ["Feature", "Provenance", "Rate", "Baseline", "Delta"]
    : ["Feature", "Provenance", "Rate"];

  const rows: string[][] = [];
  for (const feature of VOICE_DELTA_FEATURES) {
    const rate = feature.compute(text);
    const fmt = feature.format ?? ((r: number) => r.toFixed(2));
    const rateStr = fmt(rate);

    if (hasBaseline) {
      const baselineRate = baseline.rates[feature.id];
      if (baselineRate === undefined) {
        rows.push([feature.label, feature.provenance, rateStr, "(no stat)", "-"]);
      } else {
        const baselineStr = fmt(baselineRate);
        const delta = rate - baselineRate;
        const deltaStr = feature.isFraction
          ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
        rows.push([feature.label, feature.provenance, rateStr, baselineStr, deltaStr]);
      }
    } else {
      rows.push([feature.label, feature.provenance, rateStr]);
    }
  }

  lines.push(table([headers, ...rows]).trimEnd());
  return lines.join("\n");
}
