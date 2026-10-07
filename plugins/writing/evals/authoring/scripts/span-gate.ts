#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { fromMarkdown } from "mdast-util-from-markdown";
import { stemmer } from "stemmer";
import { table } from "table";
import { visit } from "unist-util-visit";
import { PATTERNS, type PatternSpan, WEIGHTED_PATTERNS } from "../../../detection/tropes";
import {
  type Hits,
  parseLines,
  type StemmedWeight,
  weightedStemHits,
} from "../../../detection/wordlists";
import { BATCH_PATTERNS } from "../../../detection/scan";
import { wilson } from "../../../../prompting/evals/rule-precision/precision";
import { type Key, Label, Pair } from "./pairs";

/**
 * A scoreable detector: a plain regex, a function `test`, or a candidate wordlist scored
 * word-by-word. The `weighted` and `wordlist` variants report at most one location per draft,
 * since their underlying scorers (`weightedStemHits`, `compileStemmedWordlist`) return only an
 * aggregate count, never per-hit positions.
 */
export type Rule =
  | { kind: "regex"; category: string; test: RegExp }
  | {
      kind: "fn";
      category: string;
      test: (text: string) => Hits;
      spans?: ((text: string) => PatternSpan[]) | undefined;
    }
  | { kind: "weighted"; category: string; entries: StemmedWeight[]; threshold: number }
  | { kind: "wordlist"; category: string; stems: Set<string> };

export interface IndexedMatch {
  category: string;
  start: number;
  end: number;
}

export interface Overlap {
  start: number;
  end: number;
}

/** Half-open range overlap: two spans touching at a single point do not overlap. */
export function overlaps(a: Overlap, b: Overlap): boolean {
  return a.start < b.end && b.start < a.end;
}

function sampleSpan(text: string, sample: string, category: string): IndexedMatch[] {
  if (sample === "") return [];
  const start = text.toLowerCase().indexOf(sample.toLowerCase());
  return start === -1 ? [] : [{ category, start, end: start + sample.length }];
}

// `detection/tropes.ts`'s own `stripCode` collapses a fenced block's interior down to its bare
// newlines, which keeps line/column reporting correct for `scan.ts` but shifts every absolute
// char offset after the block. A labeled `Span` is a raw char offset into the source text, so
// this blanks each code node in place, one space per character (newlines kept), so an offset in
// the blanked text lands on the same character of the source.
export function blankCode(text: string): string {
  let out = text;
  visit(fromMarkdown(text), (node) => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    out = out.slice(0, start) + out.slice(start, end).replaceAll(/[^\n]/g, " ") + out.slice(end);
  });
  return out;
}

// Reports a char offset instead of a line/column, since a labeled `Span` is offset-keyed.
export function indexedScan(text: string, rule: Rule): IndexedMatch[] {
  const stripped = blankCode(text);
  if (rule.kind === "regex") {
    const flags = rule.test.flags.includes("g") ? rule.test.flags : `${rule.test.flags}g`;
    const pattern = new RegExp(rule.test.source, flags);
    const results: IndexedMatch[] = [];
    for (let m = pattern.exec(stripped); m !== null; m = pattern.exec(stripped)) {
      results.push({ category: rule.category, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) pattern.lastIndex++;
    }
    return results;
  }
  if (rule.kind === "fn") {
    if (rule.spans) {
      return rule.spans(stripped).map(({ index, matched }) => ({
        category: rule.category,
        start: index,
        end: index + matched.length,
      }));
    }
    const hits = rule.test(stripped);
    return hits.count === 0 ? [] : sampleSpan(stripped, hits.sample, rule.category);
  }
  if (rule.kind === "weighted") {
    const hits = weightedStemHits(stripped, rule.entries);
    return hits.totalWeight < rule.threshold
      ? []
      : sampleSpan(stripped, hits.samples[0] ?? "", rule.category);
  }
  const results: IndexedMatch[] = [];
  const token = /[a-zA-Z]+/g;
  for (let m = token.exec(stripped); m !== null; m = token.exec(stripped)) {
    if (rule.stems.has(stemmer(m[0].toLowerCase()))) {
      results.push({ category: rule.category, start: m.index, end: m.index + m[0].length });
    }
  }
  return results;
}

export function unionScan(text: string, rules: Rule[]): IndexedMatch[] {
  const seen = new Set<string>();
  return rules.flatMap((rule) =>
    indexedScan(text, rule).filter((hit) => {
      const key = `${hit.start}:${hit.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

/** Every regex- and function-backed pattern plus every weighted group. */
export function catalogRules(): Rule[] {
  const plain: Rule[] = [...PATTERNS, ...BATCH_PATTERNS].map((def) =>
    typeof def.test === "function"
      ? { kind: "fn", category: def.category, test: def.test, spans: def.spans }
      : { kind: "regex", category: def.category, test: def.test },
  );
  const weighted: Rule[] = WEIGHTED_PATTERNS.map((group) => ({
    kind: "weighted",
    category: group.category,
    entries: group.entries,
    threshold: group.threshold,
  }));
  return [...plain, ...weighted];
}

/** A candidate given on the command line as `name=/pattern/flags`. */
export function parseRule(spec: string): Rule {
  const split = spec.indexOf("=");
  if (split < 1) throw new Error(`rule must be name=/pattern/flags, got: ${spec}`);
  const name = spec.slice(0, split);
  const body = spec.slice(split + 1);
  const parsed = /^\/(.*)\/([gimsuy]*)$/s.exec(body);
  const source = parsed?.[1] ?? "";
  if (source.length === 0) throw new Error(`rule pattern must be /pattern/flags, got: ${body}`);
  const given = parsed?.[2] ?? "";
  return {
    kind: "regex",
    category: name,
    test: new RegExp(source, given.includes("g") ? given : `${given}g`),
  };
}

/** A candidate wordlist scored as one rule. */
export function wordlistRule(name: string, content: string): Rule {
  const stems = new Set<string>();
  for (const entry of parseLines(content)) {
    for (const word of entry.toLowerCase().match(/[a-zA-Z]+/g) ?? []) stems.add(stemmer(word));
  }
  return { kind: "wordlist", category: name, stems };
}

export interface DefectSpan {
  pairId: string;
  key: Key;
  start: number;
  end: number;
}

/** Every span Ben marked critical or minor, across every label, win or loss. */
export function defectSpans(labels: Label[]): DefectSpan[] {
  return labels.flatMap((label) =>
    label.spans
      .filter((s) => s.severity === "critical" || s.severity === "minor")
      .map((s) => ({ pairId: label.id, key: s.key, start: s.start, end: s.end })),
  );
}

export interface PoolDraft {
  pairId: string;
  key: Key;
  text: string;
}

/** The draft Ben picked in every non-tie pair: the precision pool. */
export function precisionPool(pairs: Map<string, Pair>, labels: Label[]): PoolDraft[] {
  return labels.flatMap((label) => {
    if (label.pick === "tie") return [];
    const pair = pairs.get(label.id);
    if (!pair) return [];
    return [{ pairId: label.id, key: label.pick, text: pair[label.pick].text }];
  });
}

export interface SetScore {
  recallHits: number;
  totalDefects: number;
  recall: number;
  flagged: number;
  confirmed: number;
  precision: number;
  low: number;
  high: number;
}

/**
 * Recall over every marked defect span (win or loss); precision over every hit the rule set
 * produces on the drafts Ben preferred (the precision pool), Wilson 95% interval. A `rules` list
 * of more than one is scored as their union: a span counts as found, or a hit as flagged, once
 * per span/hit even when several rules independently cover it.
 */
export function scoreRules(rules: Rule[], pairs: Map<string, Pair>, labels: Label[]): SetScore {
  const defects = defectSpans(labels);
  const pool = precisionPool(pairs, labels);

  let recallHits = 0;
  for (const defect of defects) {
    const pair = pairs.get(defect.pairId);
    if (!pair) continue;
    const text = pair[defect.key].text;
    if (unionScan(text, rules).some((hit) => overlaps(hit, defect))) recallHits++;
  }

  let flagged = 0;
  let confirmed = 0;
  for (const draft of pool) {
    const draftDefects = defects.filter((d) => d.pairId === draft.pairId && d.key === draft.key);
    for (const hit of unionScan(draft.text, rules)) {
      flagged++;
      if (draftDefects.some((d) => overlaps(hit, d))) confirmed++;
    }
  }

  const [low, high] = wilson(confirmed, flagged);
  return {
    recallHits,
    totalDefects: defects.length,
    recall: defects.length === 0 ? 0 : recallHits / defects.length,
    flagged,
    confirmed,
    precision: flagged === 0 ? 0 : confirmed / flagged,
    low,
    high,
  };
}

export interface RuleReport {
  rule: string;
  score: SetScore;
  judged: boolean;
}

export function scoreCatalog(
  rules: Rule[],
  pairs: Map<string, Pair>,
  labels: Label[],
  minFlagged: number,
): RuleReport[] {
  return rules
    .map((rule) => {
      const score = scoreRules([rule], pairs, labels);
      return { rule: rule.category, score, judged: score.flagged >= minFlagged };
    })
    .toSorted((a, b) => b.score.recall - a.score.recall);
}

export interface BaselineVerdict {
  shipped: SetScore;
  candidate: SetScore;
  recallRises: boolean;
  precisionHolds: boolean;
  pass: boolean;
}

/** The offline gate: a candidate rule set clears only when it finds more and flags no worse. */
export function scoreBaseline(
  shippedRules: Rule[],
  candidateRules: Rule[],
  pairs: Map<string, Pair>,
  labels: Label[],
): BaselineVerdict {
  const shipped = scoreRules(shippedRules, pairs, labels);
  const candidate = scoreRules(candidateRules, pairs, labels);
  const recallRises = candidate.recall > shipped.recall;
  const precisionHolds = candidate.low >= shipped.low;
  return { shipped, candidate, recallRises, precisionHolds, pass: recallRises && precisionHolds };
}

async function loadJsonDir<T>(dir: string, parse: (data: unknown) => T): Promise<T[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  return Promise.all(names.map(async (n) => parse(await Bun.file(join(dir, n)).json())));
}

export async function loadPairs(dir: string): Promise<Map<string, Pair>> {
  const pairs = await loadJsonDir(dir, (data) => Pair.parse(data));
  return new Map(pairs.map((p) => [p.id, p]));
}

export async function loadLabels(dir: string): Promise<Label[]> {
  return loadJsonDir(dir, (data) => Label.parse(data));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function renderReport(reports: RuleReport[], minFlagged: number): string {
  const rows = reports.map(({ rule, score, judged }) => [
    rule,
    `${score.recallHits}/${score.totalDefects}`,
    percent(score.recall),
    String(score.flagged),
    judged
      ? `${percent(score.precision)} (${percent(score.low)}-${percent(score.high)})`
      : "too few to judge",
  ]);
  const preamble = `${reports[0]?.score.totalDefects ?? 0} marked defect spans; a rule needs ${minFlagged}+ hits on the precision pool before its precision is judged.`;
  return `${preamble}\n${table([["Rule", "Recall spans", "Recall", "Hits", "Precision (95% CI)"], ...rows])}`;
}

export function renderBaseline(verdict: BaselineVerdict): string {
  const row = (label: string, s: SetScore) => [
    label,
    `${s.recallHits}/${s.totalDefects}`,
    percent(s.recall),
    String(s.flagged),
    `${percent(s.precision)} (${percent(s.low)}-${percent(s.high)})`,
  ];
  const head = ["Set", "Recall spans", "Recall", "Hits", "Precision (95% CI)"];
  const summary = [
    `recall ${verdict.recallRises ? "rises" : "does not rise"} (candidate ${percent(verdict.candidate.recall)} vs shipped ${percent(verdict.shipped.recall)})`,
    `precision lower bound ${verdict.precisionHolds ? "holds" : "falls"} (candidate ${percent(verdict.candidate.low)} vs shipped ${percent(verdict.shipped.low)})`,
    verdict.pass ? "gate: pass" : "gate: fail",
  ].join("\n");
  return `${table([head, row("shipped", verdict.shipped), row("candidate", verdict.candidate)])}\n${summary}`;
}

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("span-gate.ts")
  .description(
    "Score a trope rule, or a candidate, against Ben's blind pairwise span labels: recall on marked defect spans, precision on the drafts he preferred.",
  )
  .option("--pairs <dir>", "Directory of Pair JSON files", "")
  .option("--labels <dir>", "Directory of Ben's Label JSON files", "")
  .option(
    "--rule <spec>",
    "Candidate to score instead of the shipped set, as name=/pattern/flags",
    collect,
    [],
  )
  .option("--wordlist <file>", "Score this wordlist file as one candidate rule")
  .option(
    "--min-flagged <n>",
    "Hits a rule needs on the precision pool before its precision is judged",
    int,
    10,
  )
  .option(
    "--baseline",
    "Compare the candidate rule set against the shipped set and exit non-zero unless it clears",
  )
  .action(async (options) => {
    if (options.pairs === "" || options.labels === "") {
      console.error("--pairs and --labels are required.");
      process.exit(2);
    }

    const [pairs, labels] = await Promise.all([
      loadPairs(options.pairs),
      loadLabels(options.labels),
    ]);

    const candidates: Rule[] = options.rule.map(parseRule);
    if (options.wordlist !== undefined && options.wordlist !== "") {
      candidates.push(wordlistRule(options.wordlist, await Bun.file(options.wordlist).text()));
    }

    if (options.baseline) {
      if (candidates.length === 0) {
        console.error("--baseline needs at least one --rule or --wordlist candidate.");
        process.exit(2);
      }
      const verdict = scoreBaseline(catalogRules(), candidates, pairs, labels);
      console.log(renderBaseline(verdict));
      process.exit(verdict.pass ? 0 : 1);
    }

    const rules = candidates.length > 0 ? candidates : catalogRules();
    const reports = scoreCatalog(rules, pairs, labels, options.minFlagged);
    console.log(renderReport(reports, options.minFlagged));
  });

if (import.meta.main) await program.parseAsync();
