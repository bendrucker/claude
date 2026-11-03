import { table } from "table";
import { CEILING, type RuleComplexity } from "./complexity";
import type { Flag, Hit, Label, Pattern, Score } from "./data";
import { type Call, type Rating, rateAll } from "./deck";
import { best, evidence, FLOOR, type Stage, stage } from "./score";

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

export type CheckRow = Omit<Rating, "unlabeled">;

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

const CALL_ORDER: readonly Call[] = ["enable", "retire", "keep", "leave off", "open"];

/** Every check's rating, settled calls first. */
export function checkRows(
  hits: readonly Hit[],
  labels: readonly Label[],
  flags: readonly Flag[],
): CheckRow[] {
  return rateAll(hits, labels, flags)
    .map(({ unlabeled: _, ...row }) => row)
    .toSorted((a, b) => {
      const order = CALL_ORDER.indexOf(a.call) - CALL_ORDER.indexOf(b.call);
      return order === 0 ? b.low - a.low : order;
    });
}

export interface Board {
  decided: number;
  open: number;
  calls: CheckRow[];
}

export function board(rows: readonly CheckRow[]): Board {
  const open = rows.filter((row) => row.call === "open").length;
  return {
    decided: rows.length - open,
    open,
    calls: rows.filter((row) => row.call !== "open"),
  };
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
  const labeled = checks.filter((row) => row.right + row.wrong > 0);
  const checkTable = table([
    ["check", "shipped", "hits", "right", "wrong", "interval", `call at ${percent(FLOOR)}`],
    ...labeled.map((row) => [
      row.check,
      row.shipped ? "yes" : "no",
      row.hits,
      row.right,
      row.wrong,
      `${percent(row.low)}-${percent(row.high)}`,
      row.call,
    ]),
  ]);
  return `${patterns.length === 0 ? "No patterns yet.\n" : patternTable}\n${labeled.length === 0 ? "No labeled checks yet.\n" : checkTable}\n${unassigned} flags without a pattern.\n`;
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
