#!/usr/bin/env bun
// Burrows's Delta: authorship distance as the mean absolute difference of
// standardized frequencies over the most frequent words of a reference corpus.
// Burrows (2002), "'Delta': a Measure of Stylistic Difference and a Guide to
// Likely Authorship", Literary and Linguistic Computing 17(3), 267-287.
// https://doi.org/10.1093/llc/17.3.267

import { cli } from "cleye";
import {
  CORPUS_FLAGS,
  type CorpusHeader,
  corpusHeaderLines,
  selectCorpora,
} from "./corpus-selection";
import { type NGramCounts, processCorpus } from "./ngram";
import { readCorpus, splitHalves, type VoiceDocument } from "./voice-corpus";

export interface Bin {
  tokens: number;
  counts: NGramCounts;
}

export function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

// Documents in the register that pairs with the baseline run 70 to 200 words,
// well under the length at which a word's rate in one document is anything but
// sampling noise. Pooling whole documents in corpus order into fixed-size bins
// makes the bin the unit of observation.
export function binDocuments(docs: VoiceDocument[], binWords: number): Bin[] {
  positiveInteger("bin size", binWords);
  const bins: Bin[] = [];
  let current: Bin = { tokens: 0, counts: new Map() };
  for (const doc of docs) {
    const stats = processCorpus(doc.body, [1]);
    if (stats.tokens === 0) continue;
    current.tokens += stats.tokens;
    for (const [word, count] of stats.ngrams.get(1) ?? []) {
      current.counts.set(word, (current.counts.get(word) ?? 0) + count);
    }
    if (current.tokens >= binWords) {
      bins.push(current);
      current = { tokens: 0, counts: new Map() };
    }
  }
  // A trailing short bin carries a noisier profile than the rest, so dropping it
  // keeps every observation on the same footing.
  return bins;
}

function totalTokens(bins: Bin[]): number {
  return bins.reduce((sum, bin) => sum + bin.tokens, 0);
}

function relativeFrequency(bin: Bin, word: string): number {
  return bin.tokens === 0 ? 0 : (bin.counts.get(word) ?? 0) / bin.tokens;
}

export function mostFrequentWords(bins: Bin[], count: number): string[] {
  const totals = new Map<string, number>();
  for (const bin of bins) {
    for (const [word, n] of bin.counts) totals.set(word, (totals.get(word) ?? 0) + n);
  }
  return [...totals]
    .toSorted(([leftWord, left], [rightWord, right]) =>
      right === left ? leftWord.localeCompare(rightWord) : right - left,
    )
    .slice(0, count)
    .map(([word]) => word);
}

export interface WordStats {
  mean: number;
  sd: number;
}

// Standardizing against the reference corpus's own spread is what makes Delta an
// authorship measure rather than a frequency one: a word that barely varies in
// the reference weighs as heavily as a common one when it does move.
export function standardize(words: string[], reference: Bin[]): Map<string, WordStats> {
  const stats = new Map<string, WordStats>();
  if (reference.length === 0) return stats;
  for (const word of words) {
    const rates = reference.map((bin) => relativeFrequency(bin, word));
    const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const variance = rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / rates.length;
    stats.set(word, { mean, sd: Math.sqrt(variance) });
  }
  return stats;
}

// Null where the reference gives the word no spread, which leaves it carrying no
// information about the bin.
export function zScore(bin: Bin, word: string, stats: Map<string, WordStats>): number | null {
  const stat = stats.get(word);
  if (stat === undefined || stat.sd === 0) return null;
  return (relativeFrequency(bin, word) - stat.mean) / stat.sd;
}

// The reference centroid sits at z=0 on every word by construction, so a bin's
// Delta from it is the mean magnitude of the bin's own z-scores.
export function deltaFromCentroid(
  bin: Bin,
  words: string[],
  stats: Map<string, WordStats>,
): number {
  let sum = 0;
  let scored = 0;
  for (const word of words) {
    const z = zScore(bin, word, stats);
    if (z === null) continue;
    sum += Math.abs(z);
    scored += 1;
  }
  return scored === 0 ? 0 : sum / scored;
}

// Nearest rank. At 20 or fewer values p95 is the sample maximum, so the floor it
// yields is the furthest the held-out reference itself reached.
function quantileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

export interface DeltaSummary {
  bins: number;
  median: number;
  p95: number;
}

export function summarizeDeltas(values: number[]): DeltaSummary {
  const sorted = values.toSorted((x, y) => x - y);
  return {
    bins: values.length,
    median: quantileOfSorted(sorted, 0.5),
    p95: quantileOfSorted(sorted, 0.95),
  };
}

export interface WordDrift {
  word: string;
  studyZ: number;
  referenceZ: number;
}

// Signed, so the report says whether a word is overused or underused rather than
// only that it moved. The held-out reference column is that word's own floor.
export function wordDrift(
  study: Bin[],
  heldOut: Bin[],
  words: string[],
  stats: Map<string, WordStats>,
): WordDrift[] {
  const meanZ = (bins: Bin[], word: string): number => {
    if (bins.length === 0) return 0;
    return bins.reduce((sum, bin) => sum + (zScore(bin, word, stats) ?? 0), 0) / bins.length;
  };
  return words
    .filter((word) => (stats.get(word)?.sd ?? 0) > 0)
    .map((word) => ({ word, studyZ: meanZ(study, word), referenceZ: meanZ(heldOut, word) }))
    .toSorted((left, right) => Math.abs(right.studyZ) - Math.abs(left.studyZ));
}

export interface Scored {
  name: string;
  summary: DeltaSummary;
  /** Bins scoring above the held-out reference p95. */
  aboveFloor: number;
}

export interface Corpus {
  name: string;
  bins: Bin[];
}

export interface DeltaMeasurement {
  words: string[];
  /** Of those, the words carrying spread in the reference. Only these score. */
  scored: string[];
  stats: Map<string, WordStats>;
  reference: DeltaSummary;
  study: Scored;
  /** The same author in the registers not used as the reference. */
  controls: Scored[];
  drift: WordDrift[];
}

// One bin per half leaves the standardizer nothing to measure spread across.
const MIN_HALF_BINS = 2;

// Every distance is a mean over the words carrying spread, so with none of them
// the whole report comes back 0.000 and reads as perfect agreement with the
// baseline. Each of these has to fail loudly instead.
function requireMeasurable(study: Corpus, scored: string[], wordCount: number): void {
  if (study.bins.length === 0) {
    throw new Error(
      "The study corpus filled no bin. Lower --bin-words, or widen --kind and --study-filter.",
    );
  }
  if (scored.length === 0) {
    throw new Error(
      `None of the ${wordCount} most frequent words varies across the fitting half, ` +
        "so every distance would read 0.000. Lower --bin-words or add a --baseline register.",
    );
  }
}

// Fitting on one half and scoring the other keeps every held-out bin out of the
// word selection and the standardizer alike, so the reference spread is the
// distance a same-author text actually travels.
export function measure(
  study: Corpus,
  referenceBins: Bin[],
  controls: Corpus[],
  wordCount: number,
): DeltaMeasurement {
  positiveInteger("word count", wordCount);
  const [fit, heldOut] = splitHalves(referenceBins);
  if (fit.length < MIN_HALF_BINS || heldOut.length < MIN_HALF_BINS) {
    throw new Error(
      `The reference splits into ${fit.length} fitting and ${heldOut.length} held-out bins, ` +
        `short of the ${MIN_HALF_BINS} each half needs. Lower --bin-words or add a --baseline register.`,
    );
  }
  const words = mostFrequentWords(fit, wordCount);
  const stats = standardize(words, fit);
  const scored = words.filter((word) => (stats.get(word)?.sd ?? 0) > 0);
  requireMeasurable(study, scored, wordCount);
  const reference = summarizeDeltas(heldOut.map((bin) => deltaFromCentroid(bin, words, stats)));

  const score = ({ name, bins }: Corpus): Scored => {
    const deltas = bins.map((bin) => deltaFromCentroid(bin, words, stats));
    return {
      name,
      summary: summarizeDeltas(deltas),
      aboveFloor: deltas.filter((delta) => delta > reference.p95).length,
    };
  };

  return {
    words,
    scored,
    stats,
    reference,
    study: score(study),
    controls: controls.map(score),
    drift: wordDrift(study.bins, heldOut, words, stats),
  };
}

function scoredLine({ name, summary, aboveFloor }: Scored): string {
  const label = `  ${name.padEnd(22)} ${String(summary.bins).padStart(4)} bins`;
  // A register too small to fill one bin was never measured, and printing 0.000
  // for it would read as agreement with the baseline.
  if (summary.bins === 0) return `${label}  too little text to measure`;
  const share = ((aboveFloor / summary.bins) * 100).toFixed(1);
  return `${label}  median ${summary.median.toFixed(3)}  above floor ${aboveFloor} (${share}%)`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export interface DeltaReport extends CorpusHeader {
  binWords: number;
  wordCount: number;
  measurement: DeltaMeasurement;
  show: number;
}

export function renderReport(report: DeltaReport): string {
  const { measurement } = report;
  return [
    ...corpusHeaderLines(report),
    `bin ${report.binWords.toLocaleString()} words  words ${report.wordCount}  ` +
      `scored over ${measurement.scored.length} of ${measurement.words.length} carrying spread`,
    "",
    "delta from the reference centroid",
    `  ${"held-out reference".padEnd(22)} ${String(measurement.reference.bins).padStart(4)} bins  ` +
      `median ${measurement.reference.median.toFixed(3)}`,
    scoredLine(measurement.study),
    "",
    "same author, other registers: the distance a register shift alone reaches",
    ...measurement.controls.map(scoredLine),
    "",
    `top ${report.show} words by distance (signed mean z, reference held-out for comparison)`,
    ...measurement.drift
      .slice(0, report.show)
      .map(
        (row) =>
          `  ${row.word.padEnd(16)} study ${signed(row.studyZ).padStart(7)}  ` +
          `reference ${signed(row.referenceZ).padStart(7)}`,
      ),
  ].join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "burrows-delta",
    // A mistyped flag would otherwise be ignored, and the report would answer a
    // different question than the one asked.
    strictFlags: true,
    help: {
      description:
        "Measure authorship distance between agent-authored prose and the pre-agent " +
        "voice baseline by Burrows's Delta over the most frequent words of the baseline.",
    },
    flags: {
      ...CORPUS_FLAGS,
      binWords: { type: Number, default: 1000, description: "Words pooled into each bin" },
      words: { type: Number, default: 150, description: "Most frequent words to score over" },
      show: { type: Number, default: 25, description: "Words to print in the drift table" },
      json: { type: Boolean, description: "Emit the measurement as JSON" },
    },
  });

  const selection = await selectCorpora(argv.flags);
  const { baseline } = selection;

  // Every register under the voice baseline is the same author, so the ones not
  // spent on the reference price what a register shift alone costs.
  const controlPaths = selection.registers.filter((path) => !baseline.paths.includes(path));
  const perControl = await Promise.all(controlPaths.map(readCorpus));

  const { binWords, words: wordCount } = argv.flags;
  const show = positiveInteger("show", argv.flags.show);
  const study = { name: "study", bins: binDocuments(selection.study.documents, binWords) };
  const referenceBins = binDocuments(baseline.documents, binWords);
  const controls = perControl.map((docs, index) => ({
    name: controlPaths[index]?.split("/").pop() ?? "control",
    bins: binDocuments(docs, binWords),
  }));
  const measurement = measure(study, referenceBins, controls, wordCount);

  if (argv.flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          kinds: selection.study.kinds,
          binWords,
          scored: measurement.scored,
          reference: measurement.reference,
          study: measurement.study,
          controls: measurement.controls,
          drift: measurement.drift,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${renderReport({
        study: {
          path: selection.study.path,
          kinds: selection.study.kinds,
          docs: selection.study.documents.length,
          tokens: totalTokens(study.bins),
        },
        baseline: {
          names: baseline.names,
          docs: baseline.documents.length,
          tokens: totalTokens(referenceBins),
        },
        binWords,
        wordCount,
        measurement,
        show,
      })}\n`,
    );
  }
}
