#!/usr/bin/env bun
// Log-odds ratio with an informative Dirichlet prior. Monroe, Colaresi & Quinn
// (2008), "Fightin' Words: Lexical Feature Selection and Evaluation for
// Identifying the Content of Political Conflict", section 3.5.

import { stemmer } from "stemmer";
import { addNgrams, cleanText, type NGramCounts, splitSentences, tokenizeSentence } from "./ngram";

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
  /** Shortest sentence each term was seen in, for eyeballing what a term means. */
  examples: Map<string, string>;
}

// cleanText drops code, paths, and identifiers, which otherwise dominate any
// contrast drawn over engineering prose.
export function tokenizeCorpus(text: string, sizes: number[]): TokenizedCorpus {
  const corpus: TokenizedCorpus = {
    tokens: 0,
    ngrams: new Map(sizes.map((n) => [n, new Map<string, number>()])),
    examples: new Map(),
  };

  for (const sentence of splitSentences(cleanText(text))) {
    const tokens = tokenizeSentence(sentence);
    if (tokens.length === 0) continue;
    corpus.tokens += tokens.length;
    for (const n of sizes) {
      const counts = corpus.ngrams.get(n);
      if (!counts) continue;
      addNgrams(counts, tokens, n);
      for (let i = 0; i <= tokens.length - n; i++) {
        const key = tokens.slice(i, i + n).join(" ");
        const seen = corpus.examples.get(key);
        if (seen === undefined || sentence.length < seen.length) {
          corpus.examples.set(key, sentence);
        }
      }
    }
  }

  return corpus;
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
}

export interface RankedTerm extends FightinWordsRow {
  n: number;
  example: string;
}

export function rank(a: TokenizedCorpus, b: TokenizedCorpus, options: RankOptions): RankedTerm[] {
  const ranked: RankedTerm[] = [];
  for (const n of options.sizes) {
    const rows = fightinWords({
      a: a.ngrams.get(n) ?? new Map(),
      b: b.ngrams.get(n) ?? new Map(),
      totalA: a.tokens,
      totalB: b.tokens,
      prior: options.prior,
    });
    for (const row of rows) {
      if (row.countA < options.minCount) continue;
      ranked.push({ ...row, n, example: a.examples.get(row.term) ?? "" });
    }
  }
  ranked.sort((left, right) => right.z - left.z);
  return ranked;
}
