#!/usr/bin/env bun
// Log-odds ratio with an informative Dirichlet prior. Monroe, Colaresi & Quinn
// (2008), "Fightin' Words: Lexical Feature Selection and Evaluation for
// Identifying the Content of Political Conflict", section 3.5.

import { stemmer } from "stemmer";
import { type NGramCounts, processRows } from "./ngram";
import type { VoiceDocument } from "./voice-corpus";

export interface FightinWordsInput {
  /** Term counts for the corpus under study. */
  a: NGramCounts;
  /** Term counts for the reference corpus. */
  b: NGramCounts;
  totalA: number;
  totalB: number;
  /** Dirichlet concentration (alpha-0). Monroe et al. use 500-1000. */
  prior: number;
}

export interface FightinWordsRow {
  term: string;
  countA: number;
  countB: number;
  /** Difference of log-odds. Positive means overrepresented in A. */
  delta: number;
  /** delta divided by its standard deviation. The ranking statistic. */
  z: number;
}

// Each term's prior is its pooled rate scaled to alpha-0, so the prior sums to
// alpha-0 and pads both corpora by that same mass.
export function fightinWords({
  a,
  b,
  totalA,
  totalB,
  prior,
}: FightinWordsInput): FightinWordsRow[] {
  if (!Number.isFinite(prior) || prior <= 0) {
    throw new Error(`prior must be a positive number, got ${prior}`);
  }
  const background = totalA + totalB;
  if (background === 0) return [];

  const terms = new Set([...a.keys(), ...b.keys()]);
  const nA = totalA + prior;
  const nB = totalB + prior;

  const rows: FightinWordsRow[] = [];
  for (const term of terms) {
    const countA = a.get(term) ?? 0;
    const countB = b.get(term) ?? 0;
    const alpha = (prior * (countA + countB)) / background;

    const yA = countA + alpha;
    const yB = countB + alpha;
    const delta = Math.log(yA / (nA - yA)) - Math.log(yB / (nB - yB));
    const variance = 1 / yA + 1 / yB;

    rows.push({ term, countA, countB, delta, z: delta / Math.sqrt(variance) });
  }

  rows.sort((left, right) => right.z - left.z);
  return rows;
}

export interface TokenizedCorpus {
  tokens: number;
  ngrams: Map<number, NGramCounts>;
  /** Documents each term appears in. A term confined to one is an artifact. */
  spread: Map<string, number>;
  /** Shortest sentence each term was seen in, for eyeballing what a term means. */
  examples: Map<string, string>;
}

function assertSizes(sizes: number[]): void {
  for (const n of sizes) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`n-gram size must be a positive integer, got ${n}`);
    }
  }
}

// Counting per document rather than over one joined string keeps the spread,
// which is what separates a habit from one document's quirk.
export function tokenizeCorpus(docs: VoiceDocument[], sizes: number[]): TokenizedCorpus {
  assertSizes(sizes);
  const examples = new Map<string, string>();
  const { stats, sessionSpread } = processRows(
    docs.map((doc) => ({ session_id: doc.source, text: doc.body })),
    sizes,
    { examples },
  );
  return { tokens: stats.tokens, ngrams: stats.ngrams, spread: sessionSpread, examples };
}

// Monroe's alpha sums to alpha-0 only against the count of the feature being
// analyzed, and a corpus holds fewer bigrams than tokens.
function featureTotal(counts: NGramCounts | undefined): number {
  let total = 0;
  for (const count of counts?.values() ?? []) total += count;
  return total;
}

// Stem as the detection wordlists do, so "delves" and "delve" are one entry.
export function stemTerm(term: string): string {
  return term
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => stemmer(word.toLowerCase()))
    .join(" ");
}

export interface RankOptions {
  sizes: number[];
  prior: number;
  /** Drop terms seen fewer times than this in A. Guards against hapax noise. */
  minCount: number;
  /** Drop terms confined to fewer than this many documents of A. */
  minDocs: number;
}

export interface RankedTerm extends FightinWordsRow {
  n: number;
  docs: number;
  example: string;
}

export function rank(a: TokenizedCorpus, b: TokenizedCorpus, options: RankOptions): RankedTerm[] {
  const ranked: RankedTerm[] = [];
  for (const n of options.sizes) {
    const rows = fightinWords({
      a: a.ngrams.get(n) ?? new Map(),
      b: b.ngrams.get(n) ?? new Map(),
      totalA: featureTotal(a.ngrams.get(n)),
      totalB: featureTotal(b.ngrams.get(n)),
      prior: options.prior,
    });
    for (const row of rows) {
      if (row.countA < options.minCount) continue;
      const docs = a.spread.get(row.term) ?? 0;
      if (docs < options.minDocs) continue;
      ranked.push({ ...row, n, docs, example: a.examples.get(row.term) ?? "" });
    }
  }
  ranked.sort((left, right) => right.z - left.z);
  return ranked;
}
