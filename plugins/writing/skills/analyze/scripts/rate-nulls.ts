#!/usr/bin/env bun

// Voice-delta rate features measured against a permutation null. The baseline
// corpus is split against itself many times and each feature's between-half gap
// recorded, which gives the gap reachable when there is no difference to find.
// A feature whose study-versus-baseline gap does not clear that floor is
// reporting sampling noise.

import { cli } from "cleye";
import { table } from "table";
import {
  CORPUS_FLAGS,
  corpusHeader,
  corpusHeaderLines,
  type CorpusSelection,
  selectCorpora,
} from "./corpus-selection";
import {
  RETIRED_FEATURES,
  strippedWordCount,
  VOICE_DELTA_FEATURES,
  type VoiceDeltaFeature,
} from "./voice-delta";
import type { VoiceDocument } from "./voice-corpus";

/** Feature id to the feature's rate for each document, in corpus order. */
export type RateMatrix = Map<string, number[]>;

export function rateMatrix(
  docs: VoiceDocument[],
  features: VoiceDeltaFeature[] = VOICE_DELTA_FEATURES,
): RateMatrix {
  const matrix: RateMatrix = new Map();
  for (const feature of features) {
    matrix.set(
      feature.id,
      docs.map((doc) => feature.compute(doc.body)),
    );
  }
  return matrix;
}

export function meanOf(rates: number[], indices: number[]): number {
  if (indices.length === 0) return 0;
  let total = 0;
  for (const index of indices) total += rates[index] ?? 0;
  return total / indices.length;
}

// Seeded so a printed floor can be reproduced from the flags in the header.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffledHalves(size: number, random: () => number): [number[], number[]] {
  const order = Array.from({ length: size }, (_, index) => index);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = swap;
  }
  const middle = Math.floor(size / 2);
  return [order.slice(0, middle), order.slice(middle, middle * 2)];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export interface FeatureFloor {
  featureId: string;
  label: string;
  provenance: string;
  /** Mean rate over the whole baseline corpus. */
  baseline: number;
  /** Mean rate over corpus A. */
  study: number;
  /** Observed |study - baseline|. */
  gap: number;
  /** Largest gap a same-corpus split reaches at the requested percentile. */
  floor: number | null;
  /** Reason the floor is null. */
  unfloored: string | null;
}

export interface FloorOptions {
  splits: number;
  percentile: number;
  seed: number;
}

// Two documents cannot be split into halves that each hold one document and
// still say anything about sampling spread.
const MIN_BASELINE_DOCS = 4;

export function featureFloors(
  study: VoiceDocument[],
  baseline: VoiceDocument[],
  options: FloorOptions,
  features: VoiceDeltaFeature[] = VOICE_DELTA_FEATURES,
): FeatureFloor[] {
  const studyRates = rateMatrix(study, features);
  const baselineRates = rateMatrix(baseline, features);
  const all = Array.from({ length: baseline.length }, (_, index) => index);
  const random = mulberry32(options.seed);
  const halves = Array.from({ length: options.splits }, () =>
    shuffledHalves(baseline.length, random),
  );
  const unfloored =
    baseline.length < MIN_BASELINE_DOCS
      ? `baseline holds ${baseline.length} documents, fewer than the ${MIN_BASELINE_DOCS} a split needs`
      : null;

  return features.map((feature) => {
    const rates = baselineRates.get(feature.id) ?? [];
    const baselineMean = meanOf(rates, all);
    const studyMean = meanOf(
      studyRates.get(feature.id) ?? [],
      Array.from({ length: study.length }, (_, index) => index),
    );
    const gaps = halves.map(([left, right]) =>
      Math.abs(meanOf(rates, left) - meanOf(rates, right)),
    );
    return {
      featureId: feature.id,
      label: feature.label,
      provenance: feature.provenance,
      baseline: baselineMean,
      study: studyMean,
      gap: Math.abs(studyMean - baselineMean),
      floor: unfloored === null ? percentile(gaps, options.percentile) : null,
      unfloored,
    };
  });
}

/** How far the observed gap clears its floor. Null when there is no floor. */
export function margin(floor: FeatureFloor): number | null {
  if (floor.floor === null) return null;
  return floor.floor === 0 ? Number.POSITIVE_INFINITY : floor.gap / floor.floor;
}

export function clearsFloor(floor: FeatureFloor): boolean {
  return floor.floor === null || floor.gap > floor.floor;
}

function fixed(value: number): string {
  if (value === 0) return "0";
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toPrecision(3);
}

export function renderReport(floors: FeatureFloor[], options: FloorOptions): string {
  const ordered = floors.toSorted((a, b) => (margin(b) ?? -1) - (margin(a) ?? -1));
  const rows = ordered.map((floor) => {
    const ratio = margin(floor);
    let verdict: string;
    if (!clearsFloor(floor)) {
      verdict = "noise";
    } else if (floor.floor === null) {
      verdict = "unmeasured";
    } else {
      verdict = "clears";
    }
    return [
      floor.featureId,
      floor.provenance,
      fixed(floor.baseline),
      fixed(floor.study),
      fixed(floor.gap),
      floor.floor === null ? "n/a" : fixed(floor.floor),
      ratio === null ? "n/a" : `${ratio.toFixed(2)}x`,
      verdict,
    ];
  });

  const lines = [
    `${options.splits} random splits of corpus B against itself, floor at the ${options.percentile}th percentile, seed ${options.seed}`,
    "",
    table([
      ["feature", "provenance", "corpus B", "corpus A", "gap", "floor", "gap/floor", "verdict"],
      ...rows,
    ]),
  ];

  const noise = ordered.filter((floor) => !clearsFloor(floor));
  const unmeasured = ordered.filter((floor) => floor.floor === null);
  lines.push(
    `${ordered.length - noise.length - unmeasured.length} of ${ordered.length} features clear their floor.`,
  );
  if (noise.length > 0) {
    lines.push(`Below floor: ${noise.map((floor) => floor.featureId).join(", ")}`);
  }
  for (const floor of unmeasured) {
    lines.push(`No floor for ${floor.featureId}: ${floor.unfloored ?? "unknown"}. It stays.`);
  }
  return lines.join("\n");
}

function words(docs: VoiceDocument[]): number {
  return docs.reduce((total, doc) => total + (doc.body.match(/\S+/g) ?? []).length, 0);
}

export interface LengthBand {
  min?: number | undefined;
  max?: number | undefined;
}

// Corpus A documents run several times longer than corpus B's, so any feature
// that varies with document length reports that length difference as voice.
// Restricting both corpora to one length band separates the two: a gap that
// survives the band is about how the prose is written, and one that collapses
// was body_length measured a second time.
export function withinLength(docs: VoiceDocument[], band: LengthBand): VoiceDocument[] {
  if (band.min === undefined && band.max === undefined) return docs;
  return docs.filter((doc) => {
    const count = strippedWordCount(doc.body);
    return count >= (band.min ?? 0) && count <= (band.max ?? Number.POSITIVE_INFINITY);
  });
}

// cleye hands back NaN both for a value it cannot parse and for `--min-words
// -5`, where it reads the negative number as another flag. NaN survives the
// `undefined` check and then fails every comparison, so an unchecked band
// silently drops the whole corpus and blames the kind selection on the way out.
export function bandError(band: LengthBand): string | null {
  for (const [flag, value] of [
    ["--min-words", band.min],
    ["--max-words", band.max],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      return `${flag} needs a whole number of words at or above zero.`;
    }
  }
  if (band.min !== undefined && band.max !== undefined && band.min > band.max) {
    return `--min-words ${band.min} is above --max-words ${band.max}, so the band selects nothing.`;
  }
  return null;
}

export function describeBand(band: LengthBand): string | null {
  if (band.min === undefined && band.max === undefined) return null;
  return `length band  ${band.min ?? 0}-${band.max ?? "∞"} words, applied to both corpora`;
}

function selectionTokens(selection: CorpusSelection): { study: number; baseline: number } {
  return { study: words(selection.study.documents), baseline: words(selection.baseline.documents) };
}

if (import.meta.main) {
  const argv = cli({
    name: "rate-nulls",
    help: {
      description:
        "Measure each voice-delta rate feature against a permutation null built by splitting the baseline corpus against itself.",
    },
    flags: {
      ...CORPUS_FLAGS,
      splits: { type: Number, default: 500, description: "Random splits of corpus B" },
      percentile: { type: Number, default: 95, description: "Floor percentile across splits" },
      seed: { type: Number, default: 1, description: "PRNG seed" },
      minWords: { type: Number, description: "Keep only documents of at least this many words" },
      maxWords: { type: Number, description: "Keep only documents of at most this many words" },
      candidates: {
        type: Boolean,
        description: "Also score the retired candidates in RETIRED_FEATURES",
      },
      json: { type: Boolean, description: "Emit the floors as JSON" },
    },
  });

  const band: LengthBand = { min: argv.flags.minWords, max: argv.flags.maxWords };
  const invalid = bandError(band);
  if (invalid !== null) {
    console.error(invalid);
    process.exit(1);
  }

  const selected = await selectCorpora(argv.flags);
  const selection: CorpusSelection = {
    ...selected,
    study: { ...selected.study, documents: withinLength(selected.study.documents, band) },
    baseline: { ...selected.baseline, documents: withinLength(selected.baseline.documents, band) },
  };
  const banded = describeBand(band);
  // A gap measured against an absent corpus equals the other corpus's mean,
  // which reads as a large effect. Name whichever input emptied the set, since
  // the band and the kind selection both reach here.
  for (const [label, documents] of [
    ["A", selection.study.documents],
    ["B", selection.baseline.documents],
  ] as const) {
    if (documents.length > 0) continue;
    const cause =
      banded === null
        ? `kinds ${selection.study.kinds.join(",")}`
        : `kinds ${selection.study.kinds.join(",")} inside the ${band.min ?? 0}-${band.max ?? "∞"} word band`;
    console.error(`No corpus ${label} documents for ${cause}.`);
    process.exit(1);
  }
  const options: FloorOptions = {
    splits: argv.flags.splits,
    percentile: argv.flags.percentile,
    seed: argv.flags.seed,
  };
  const features = argv.flags.candidates
    ? [...VOICE_DELTA_FEATURES, ...RETIRED_FEATURES]
    : VOICE_DELTA_FEATURES;
  const floors = featureFloors(
    selection.study.documents,
    selection.baseline.documents,
    options,
    features,
  );

  if (argv.flags.json) {
    console.log(JSON.stringify({ options, band, floors }, null, 2));
  } else {
    console.log(corpusHeaderLines(corpusHeader(selection, selectionTokens(selection))).join("\n"));
    if (banded !== null) console.log(banded);
    console.log("");
    console.log(renderReport(floors, options));
  }
}
