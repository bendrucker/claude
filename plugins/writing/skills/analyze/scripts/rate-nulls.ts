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
import { VOICE_DELTA_FEATURES } from "./voice-delta";
import type { VoiceDocument } from "./voice-corpus";

/** Feature id to the feature's rate for each document, in corpus order. */
export type RateMatrix = Map<string, number[]>;

export function rateMatrix(docs: VoiceDocument[]): RateMatrix {
  const matrix: RateMatrix = new Map();
  for (const feature of VOICE_DELTA_FEATURES) {
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
): FeatureFloor[] {
  const studyRates = rateMatrix(study);
  const baselineRates = rateMatrix(baseline);
  const all = Array.from({ length: baseline.length }, (_, index) => index);
  const random = mulberry32(options.seed);
  const halves = Array.from({ length: options.splits }, () =>
    shuffledHalves(baseline.length, random),
  );
  const unfloored =
    baseline.length < MIN_BASELINE_DOCS
      ? `baseline holds ${baseline.length} documents, fewer than the ${MIN_BASELINE_DOCS} a split needs`
      : null;

  return VOICE_DELTA_FEATURES.map((feature) => {
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
    return [
      floor.featureId,
      floor.provenance,
      fixed(floor.baseline),
      fixed(floor.study),
      fixed(floor.gap),
      floor.floor === null ? "n/a" : fixed(floor.floor),
      ratio === null ? "n/a" : `${ratio.toFixed(2)}x`,
      clearsFloor(floor) ? (floor.floor === null ? "unmeasured" : "clears") : "noise",
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
      json: { type: Boolean, description: "Emit the floors as JSON" },
    },
  });

  const selection = await selectCorpora(argv.flags);
  if (selection.study.documents.length === 0) {
    // Every gap would equal the baseline mean, which reads as signal and is not.
    console.error(`No corpus A documents for kinds ${selection.study.kinds.join(",")}.`);
    process.exit(1);
  }
  const options: FloorOptions = {
    splits: argv.flags.splits,
    percentile: argv.flags.percentile,
    seed: argv.flags.seed,
  };
  const floors = featureFloors(selection.study.documents, selection.baseline.documents, options);

  if (argv.flags.json) {
    console.log(JSON.stringify({ options, floors }, null, 2));
  } else {
    console.log(corpusHeaderLines(corpusHeader(selection, selectionTokens(selection))).join("\n"));
    console.log("");
    console.log(renderReport(floors, options));
  }
}
