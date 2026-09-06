import { table } from "table";
import { LEADING_FEATURE_IDS, RHYTHM_FEATURES } from "./rhythm";
import type { StyleProfile } from "./profile";
import { type DocumentScore, featureDeltas } from "./score";
import type { LocalizedWindow } from "./windows";

export const DEFAULT_EXCERPT_WIDTH = 100;

// Separation was measured down to roughly 144 words. Below that the score is
// still computed, but a reader should not act on it.
export const RELIABLE_WORD_FLOOR = 144;

export interface Report {
  input: string | undefined;
  score: DocumentScore;
  flagged: LocalizedWindow[];
  windowCount: number;
  threshold: number;
}

export function truncate(text: string, width: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  // A negative end index counts from the end of the string, which would print
  // the tail of the passage rather than a prefix.
  const room = Math.max(1, Math.trunc(width));
  return flat.length <= room ? flat : `${flat.slice(0, room - 1)}…`;
}

// The scaler is invertible, so a standardized value can be shown in the unit the
// feature was measured in.
function rawValue(standardized: number, profile: StyleProfile, index: number): number {
  return (profile.scaler.mean[index] ?? 0) + standardized * (profile.scaler.sd[index] ?? 1);
}

function verdict(percentile: number): string {
  if (percentile >= 50) return "within the voice baseline";
  if (percentile >= 25) return "toward the low end of the voice baseline";
  if (percentile >= 10) return "below most of the voice baseline";
  return "outside the voice baseline";
}

function summaryTable(score: DocumentScore): string {
  const rows = [
    ["Family", "Margin", "Percentile"],
    ["fused", score.fused.toFixed(3), score.percentile.fused.toFixed(1)],
    ["rhythm", score.rhythm.margin.toFixed(3), score.percentile.rhythm.toFixed(1)],
    ["char 3-gram", score.char.margin.toFixed(3), score.percentile.char.toFixed(1)],
  ];
  return table(rows).trimEnd();
}

function leadingFeatureTable(score: DocumentScore, profile: StyleProfile): string {
  const labels = new Map(RHYTHM_FEATURES.map((feature) => [feature.id, feature.label]));
  const deltas = featureDeltas(score, profile);
  const rows: string[][] = [["Feature", "This text", "Voice mean", "Deviation"]];
  for (const id of LEADING_FEATURE_IDS) {
    const index = profile.featureIds.indexOf(id);
    const delta = deltas[index];
    if (index < 0 || delta === undefined) continue;
    const observed = rawValue(score.rhythmVector[index] ?? 0, profile, index);
    const voiceMean = rawValue(profile.voice.rhythmCentroid[index] ?? 0, profile, index);
    rows.push([
      labels.get(id) ?? id,
      observed.toFixed(2),
      voiceMean.toFixed(2),
      `${delta.deviation >= 0 ? "+" : ""}${delta.deviation.toFixed(2)} sd`,
    ]);
  }
  return table(rows).trimEnd();
}

function windowSection(report: Report, excerptWidth: number): string {
  if (report.flagged.length === 0) {
    return `No windows fell below p${report.threshold} of the voice baseline (${report.windowCount} scored).`;
  }
  const lines = [
    `${report.flagged.length} of ${report.windowCount} windows below p${report.threshold}:`,
    "",
  ];
  for (const window of report.flagged) {
    const issues = window.issues.map((issue) => issue.message).join("; ");
    lines.push(
      `  p${window.percentile.toFixed(1)}  sentences ${window.startSentence + 1}-${window.startSentence + window.sentences.length}`,
    );
    lines.push(`    ${truncate(window.excerpt, excerptWidth)}`);
    if (issues !== "") lines.push(`    → ${issues}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderReport(
  report: Report,
  profile: StyleProfile,
  excerptWidth = DEFAULT_EXCERPT_WIDTH,
): string {
  const { score } = report;
  const header = [
    report.input ?? "(stdin)",
    `${score.words} words, ${score.sentences} sentences`,
    `p${score.percentile.fused.toFixed(1)}: ${verdict(score.percentile.fused)}`,
  ].join("  |  ");

  const short =
    score.words < RELIABLE_WORD_FLOOR
      ? [`Under ${RELIABLE_WORD_FLOOR} words: the score is noisy at this length.`, ""]
      : [];

  return [
    header,
    "",
    ...short,
    summaryTable(score),
    "",
    "Leading features",
    leadingFeatureTable(score, profile),
    "",
    windowSection(report, excerptWidth),
  ].join("\n");
}
