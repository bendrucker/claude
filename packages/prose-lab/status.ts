import { table } from "table";
import { CEILING, type RuleComplexity } from "./complexity";
import type { Flag, Hit, Label, Pattern, Score } from "./data";
import { best, clears, evidence, FLOOR, judge, MIN_LABELED, type Stage, stage } from "./score";
import { wilson } from "../evals/stats";

export interface PatternRow {
  slug: string;
  style: string;
  positives: number;
  files: number;
  negatives: number;
  candidate: string | undefined;
  low: number | undefined;
  recall: number | undefined;
  stage: Stage;
}

export interface CheckRow {
  check: string;
  hits: number;
  right: number;
  wrong: number;
  low: number;
  /** Labeled past `MIN_LABELED` with an interval floor under `FLOOR`. */
  below: boolean;
}

export function patternRows(
  patterns: readonly Pattern[],
  labels: readonly Label[],
  flags: readonly Flag[],
  scores: readonly Score[],
): PatternRow[] {
  return patterns.map((pattern) => {
    const found = evidence(pattern.slug, labels, flags);
    const top = best(scores, pattern.slug);
    return {
      slug: pattern.slug,
      style: pattern.style,
      positives: found.positives.length,
      files: found.files,
      negatives: found.negatives,
      candidate: top?.candidate,
      low: top?.low,
      recall: top?.recall,
      stage: stage(pattern, found, top),
    };
  });
}

export function checkRows(
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
): CheckRow[] {
  return [...Map.groupBy(hits, (hit) => hit.check)]
    .map(([check, group]) => {
      const { right, wrong } = judge(group, labels, flags);
      const low = right + wrong === 0 ? 0 : wilson(right, right + wrong)[0];
      return {
        check,
        hits: group.length,
        right,
        wrong,
        low,
        below: right + wrong >= MIN_LABELED && !clears({ right, wrong, low }),
      };
    })
    .filter((row) => row.right + row.wrong > 0)
    .toSorted((a, b) => a.low - b.low);
}

const percent = (value: number | undefined): string =>
  value === undefined ? "-" : `${Math.round(value * 100)}%`;

export function render(
  patterns: readonly PatternRow[],
  checks: readonly CheckRow[],
  unassigned = 0,
): string {
  const patternTable = table([
    [
      "pattern",
      "style",
      "positives",
      "files",
      "negatives",
      "best candidate",
      "floor",
      "recall",
      "stage",
    ],
    ...patterns.map((row) => [
      row.slug,
      row.style,
      row.positives,
      row.files,
      row.negatives,
      row.candidate ?? "-",
      percent(row.low),
      percent(row.recall),
      row.stage,
    ]),
  ]);
  const checkTable = table([
    ["check", "hits", "right", "wrong", "floor", `under ${percent(FLOOR)}`],
    ...checks.map((row) => [
      row.check,
      row.hits,
      row.right,
      row.wrong,
      percent(row.low),
      row.below ? "yes" : "",
    ]),
  ]);
  return `${patterns.length === 0 ? "No patterns yet.\n" : patternTable}\n${checks.length === 0 ? "No labeled checks yet.\n" : checkTable}\n${unassigned} flags without a pattern.\n`;
}

/** Rules by complexity, marking those over the ceiling. */
export function renderRules(rules: readonly RuleComplexity[]): string {
  return table([
    ["rule", "complexity", "lookarounds", "gaps", "exception words", "branches"],
    ...rules.map((rule) => [
      rule.rule,
      rule.score > CEILING ? `${rule.score} (over ${CEILING})` : rule.score,
      rule.features.lookarounds,
      rule.features.gaps,
      rule.features.exceptionWords,
      rule.features.branches,
    ]),
  ]);
}
