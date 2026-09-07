#!/usr/bin/env bun
// Burrows's Delta: authorship distance as the mean absolute difference of
// standardized frequencies over the most frequent words of a reference corpus.
// Burrows (2002), "'Delta': a Measure of Stylistic Difference and a Guide to
// Likely Authorship", Literary and Linguistic Computing 17(3), 267-287.

import { cli } from "cleye";
import { contrastCorpusPath, registerPaths, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { type NGramCounts, processCorpus } from "./ngram";
import {
  DOCUMENT_KINDS,
  documentKind,
  type DocumentKind,
  isDocumentKind,
  parseCorpus,
  splitHalves,
  type VoiceDocument,
} from "./voice-corpus";

export interface Bin {
  docs: number;
  tokens: number;
  counts: NGramCounts;
}

// Documents in the register that pairs with the baseline run 70 to 200 words,
// well under the length at which a word's rate in one document is anything but
// sampling noise. Pooling whole documents in corpus order into fixed-size bins
// makes the bin the unit of observation.
export function binDocuments(docs: VoiceDocument[], binWords: number): Bin[] {
  if (!Number.isInteger(binWords) || binWords < 1) {
    throw new Error(`bin size must be a positive integer, got ${binWords}`);
  }
  const bins: Bin[] = [];
  let current: Bin = { docs: 0, tokens: 0, counts: new Map() };
  for (const doc of docs) {
    const stats = processCorpus(doc.body, [1]);
    if (stats.tokens === 0) continue;
    current.docs += 1;
    current.tokens += stats.tokens;
    for (const [word, count] of stats.ngrams.get(1) ?? []) {
      current.counts.set(word, (current.counts.get(word) ?? 0) + count);
    }
    if (current.tokens >= binWords) {
      bins.push(current);
      current = { docs: 0, tokens: 0, counts: new Map() };
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

export function zScores(
  bin: Bin,
  words: string[],
  stats: Map<string, WordStats>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const word of words) {
    const stat = stats.get(word);
    // No spread in the reference leaves the word carrying no information.
    if (stat === undefined || stat.sd === 0) continue;
    scores.set(word, (relativeFrequency(bin, word) - stat.mean) / stat.sd);
  }
  return scores;
}

// The reference centroid sits at z=0 on every word by construction, so a bin's
// Delta from it is the mean magnitude of the bin's own z-scores.
export function deltaFromCentroid(
  bin: Bin,
  words: string[],
  stats: Map<string, WordStats>,
): number {
  const scores = [...zScores(bin, words, stats).values()];
  if (scores.length === 0) return 0;
  return scores.reduce((sum, z) => sum + Math.abs(z), 0) / scores.length;
}

export function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((x, y) => x - y);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? 0;
}

export interface DeltaSummary {
  bins: number;
  median: number;
  p95: number;
}

export function summarizeDeltas(values: number[]): DeltaSummary {
  return { bins: values.length, median: quantile(values, 0.5), p95: quantile(values, 0.95) };
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
    const scores = bins.map((bin) => zScores(bin, [word], stats).get(word) ?? 0);
    return scores.length === 0 ? 0 : scores.reduce((sum, z) => sum + z, 0) / scores.length;
  };
  return words
    .filter((word) => stats.get(word)?.sd !== 0 && stats.has(word))
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
  stats: Map<string, WordStats>;
  reference: DeltaSummary;
  study: Scored;
  /** The same author in the registers not used as the reference. */
  controls: Scored[];
  drift: WordDrift[];
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
  const [fit, heldOut] = splitHalves(referenceBins);
  const words = mostFrequentWords(fit, wordCount);
  const stats = standardize(words, fit);
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
    stats,
    reference,
    study: score(study),
    controls: controls.map(score),
    drift: wordDrift(study.bins, heldOut, words, stats),
  };
}

function share(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function scoredLine(scored: Scored): string {
  return (
    `  ${scored.name.padEnd(22)} ${String(scored.summary.bins).padStart(4)} bins  ` +
    `median ${scored.summary.median.toFixed(3)}  ` +
    `above floor ${scored.aboveFloor} (${share(scored.aboveFloor, scored.summary.bins)})`
  );
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export interface DeltaReport {
  studyPath: string;
  studyDocs: number;
  studyTokens: number;
  kinds: DocumentKind[];
  baselineNames: string[];
  baselineDocs: number;
  baselineTokens: number;
  binWords: number;
  wordCount: number;
  measurement: DeltaMeasurement;
  show: number;
}

export function renderReport(report: DeltaReport): string {
  const { measurement } = report;
  return [
    `corpus A  ${report.studyDocs} docs, ${report.studyTokens.toLocaleString()} tokens  ` +
      `kinds ${report.kinds.join(",")}  ${report.studyPath}`,
    `corpus B  ${report.baselineDocs} docs, ${report.baselineTokens.toLocaleString()} tokens  ${report.baselineNames.join(", ")}`,
    `bin ${report.binWords.toLocaleString()} words  words ${report.wordCount}  ` +
      `scored over ${measurement.words.length} most frequent`,
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

async function readCorpus(path: string): Promise<VoiceDocument[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`No corpus at ${path}`);
  return parseCorpus(await file.text());
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
      dataDir: { type: String, description: "Override the plugin data directory" },
      study: {
        type: String,
        description: "Corpus A (agent-authored). Defaults to the contrast baseline.",
      },
      baseline: {
        type: [String],
        description:
          "Corpus B register filenames. Repeatable. Default: github-prs.txt, github-issues.txt",
      },
      kind: {
        type: [String],
        description: `Corpus A document kinds to keep. Repeatable. One of ${DOCUMENT_KINDS.join(", ")}.`,
      },
      studyFilter: {
        type: String,
        description: "Narrow the kinds further to corpus A sources matching this regex",
      },
      binWords: { type: Number, default: 1000, description: "Words pooled into each bin" },
      words: { type: Number, default: 150, description: "Most frequent words to score over" },
      show: { type: Number, default: 25, description: "Words to print in the drift table" },
      json: { type: Boolean, description: "Emit the measurement as JSON" },
    },
  });

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const studyPath = argv.flags.study ?? contrastCorpusPath(dataDir);
  const baselineNames =
    argv.flags.baseline.length > 0 ? argv.flags.baseline : ["github-prs.txt", "github-issues.txt"];

  const registers = await registerPaths(dataDir);
  const baselinePaths = baselineNames.map((name) => {
    const found = registers.find((path) => path.endsWith(`/${name}`));
    if (found === undefined) {
      throw new Error(`No register ${name} under ${voiceBaselineDir(dataDir)}`);
    }
    return found;
  });

  const kinds = argv.flags.kind.map((kind) => {
    if (!isDocumentKind(kind)) {
      throw new Error(`Unknown kind ${kind}. One of ${DOCUMENT_KINDS.join(", ")}.`);
    }
    return kind;
  });
  const selected = new Set(kinds.length > 0 ? kinds : DOCUMENT_KINDS);

  // Every register under the voice baseline is the same author, so the ones not
  // spent on the reference price what a register shift alone costs.
  const controlPaths = registers.filter((path) => !baselinePaths.includes(path));

  const [studyAll, perRegister, perControl] = await Promise.all([
    readCorpus(studyPath),
    Promise.all(baselinePaths.map(readCorpus)),
    Promise.all(controlPaths.map(readCorpus)),
  ]);
  const filter = argv.flags.studyFilter === undefined ? null : new RegExp(argv.flags.studyFilter);
  const studyDocs = studyAll.filter(
    (doc) => selected.has(documentKind(doc.source)) && (filter?.test(doc.source) ?? true),
  );
  const baselineDocs = perRegister.flat();

  const { binWords, words: wordCount } = argv.flags;
  const study = { name: "study", bins: binDocuments(studyDocs, binWords) };
  const referenceBins = binDocuments(baselineDocs, binWords);
  const controls = perControl.map((docs, index) => ({
    name: controlPaths[index]?.split("/").pop() ?? "control",
    bins: binDocuments(docs, binWords),
  }));
  const measurement = measure(study, referenceBins, controls, wordCount);

  if (argv.flags.json) {
    const { words, reference, study: scored, controls: scoredControls, drift } = measurement;
    process.stdout.write(
      `${JSON.stringify(
        {
          kinds: [...selected],
          binWords,
          words,
          reference,
          study: scored,
          controls: scoredControls,
          drift,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${renderReport({
        studyPath,
        studyDocs: studyDocs.length,
        studyTokens: totalTokens(study.bins),
        kinds: [...selected],
        baselineNames,
        baselineDocs: baselineDocs.length,
        baselineTokens: totalTokens(referenceBins),
        binWords,
        wordCount,
        measurement,
        show: argv.flags.show,
      })}\n`,
    );
  }
}
