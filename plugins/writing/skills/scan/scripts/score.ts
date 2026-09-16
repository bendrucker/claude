import { table } from "table";
import { extractComments } from "../../../detection/comments";
import { isProseFile } from "../../../detection/paths";
import { scanAll } from "../../../detection/scan";
import { stripCode } from "../../../detection/tropes";
import { compileStemmedWordlist, countWords } from "../../../detection/wordlists";
import {
  describeRun,
  failedBands,
  measuredFeature,
  type WritingStatistics,
} from "../../analyze/scripts/statistics";
import { matchShapes } from "../../analyze/scripts/tag-ngram";
import {
  checkRegister,
  sentenceSplit,
  VOICE_DELTA_FEATURES,
} from "../../analyze/scripts/voice-delta";
import type { VoiceProfile } from "../../analyze/scripts/voice-profile";

export interface CategoryScore {
  category: string;
  hits: number;
  density: number;
}

export interface GroupScore {
  group: string;
  wordCount: number;
  categories: CategoryScore[];
}

export interface ScoreReport {
  filePath: string | undefined;
  groups: GroupScore[];
}

export interface ReportOptions {
  comments: boolean;
  customMatch?: (text: string) => { count: number };
}

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
// out-of-register (too short or non-prose markdown fraction). The statistics
// artifact, when present, carries the permutation null each feature's corpus
// gap was measured against, which separates the features whose delta means
// something from the ones a same-corpus split reaches on its own.
export function renderVoiceDeltaTable(
  text: string,
  profile: VoiceProfile | null,
  statistics: WritingStatistics | null = null,
): string {
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
  const runs = statistics?.rateNulls?.runs ?? [];
  const gated = hasBaseline && runs.length > 0;

  const headers = hasBaseline
    ? ["Feature", "Provenance", "Rate", "Baseline", "Delta"]
    : ["Feature", "Provenance", "Rate"];
  if (gated) headers.push("Null");

  const rows: string[][] = [];
  for (const feature of VOICE_DELTA_FEATURES) {
    const rate = feature.compute(text);
    const fmt = feature.format ?? ((r: number) => r.toFixed(2));
    const rateStr = fmt(rate);

    const row: string[] = [feature.label, feature.provenance, rateStr];
    if (hasBaseline) {
      const baselineRate = baseline.rates[feature.id];
      if (baselineRate === undefined) {
        row.push("(no stat)", "-");
      } else {
        const baselineStr = fmt(baselineRate);
        const delta = rate - baselineRate;
        const deltaStr = feature.isFraction
          ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
        row.push(baselineStr, deltaStr);
      }
    }
    if (gated) {
      const failed = failedBands(statistics, feature.id);
      const verdict = measuredFeature(statistics, feature.id)
        ? failed.length === 0
          ? "clears"
          : "noise"
        : "unmeasured";
      row.push(verdict);
    }
    rows.push(row);
  }

  lines.push(table([headers, ...rows]).trimEnd());

  if (gated) {
    const first = runs[0];
    if (first !== undefined) {
      lines.push(
        `Null floor: ${first.splits} splits of the baseline against itself at the ${first.percentile}th percentile, over the ${runs.map(describeRun).join(" and the ")}.`,
      );
    }
    const noise = VOICE_DELTA_FEATURES.map((feature) => ({
      feature,
      failed: failedBands(statistics, feature.id),
    })).filter((entry) => entry.failed.length > 0);
    if (noise.length > 0) {
      lines.push(
        `Read the delta on these as sampling spread: ${noise
          .map((entry) => `${entry.feature.label} (${entry.failed.join(", ")})`)
          .join("; ")}.`,
      );
    }
  }

  return lines.join("\n");
}

const SIGNATURE_ROWS = 8;

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Part-of-speech shapes over-represented in the agent corpus that survive a
// split of that corpus against itself. One occurrence decides nothing, so the
// reportable number is the share of the document's tag n-grams landing on a
// confirmed shape, read against the two corpus shares.
export function renderSignatureTable(
  text: string,
  statistics: WritingStatistics | null,
): string | null {
  const signatures = statistics?.tagSignatures;
  if (signatures === undefined || signatures.shapes.length === 0) return null;

  const shapes = new Set(signatures.shapes.map((signature) => signature.shape));
  const match = matchShapes(sentenceSplit(stripCode(text)), signatures.sizes, shapes);
  const lines = ["Corpus Signatures"];

  if (match.total === 0) {
    lines.push(`This document offers no tag ${signatures.sizes.join("/")}-grams to match.`);
    return lines.join("\n");
  }

  lines.push(
    `${match.hits} of ${match.total} tag n-grams land on one of ${shapes.size} confirmed shapes (${share(match.hits / match.total)}). ` +
      `Agent corpus ${share(signatures.studyShare)}, baseline ${share(signatures.baselineShare)}.`,
  );

  if (match.byShape.length > 0) {
    lines.push(
      table([
        ["Shape", "Hits"],
        ...match.byShape.slice(0, SIGNATURE_ROWS).map(({ shape, count }) => [shape, String(count)]),
      ]).trimEnd(),
    );
  }
  return lines.join("\n");
}
