// Two-pole margin scoring. Each family reports its distance to the voice
// centroid less its distance to the contrast centroid, over their mean, so
// positive is nearer the voice pole. That scaling is what lets the euclidean
// and Ruzicka margins average into one number despite their different units.

import { countGrams, profileFromCounts } from "./char-ngrams";
import { percentileOf } from "./calibration";
import type { CalibrationSet, Poles } from "./profile";
import { rhythmVector } from "./rhythm";
import type { Segmented } from "./segment";
import { euclidean, margin, ruzicka, standardize } from "./vector";

export interface FamilyScore {
  voiceDistance: number;
  contrastDistance: number;
  margin: number;
}

export interface RawScore {
  rhythm: FamilyScore;
  char: FamilyScore;
  fused: number;
  rhythmVector: number[];
}

export interface Percentiles {
  rhythm: number;
  char: number;
  fused: number;
}

export interface DocumentScore extends RawScore {
  words: number;
  sentences: number;
  percentile: Percentiles;
}

export function scoreSegmented(doc: Segmented, poles: Poles): RawScore {
  return scorePrepared(standardize(rhythmVector(doc), poles.scaler), countGrams(doc.prose), poles);
}

// Takes the two per-document intermediates rather than the document, so the
// build pass, which already computed both, does not pay for them twice.
export function scorePrepared(
  standardized: number[],
  grams: Map<string, number>,
  poles: Poles,
): RawScore {
  const chars = profileFromCounts(grams, poles.charVocabulary);

  const rhythm = family(
    euclidean(standardized, poles.voice.rhythmCentroid),
    euclidean(standardized, poles.contrast.rhythmCentroid),
  );
  const char = family(
    ruzicka(chars, poles.voice.charProfile),
    ruzicka(chars, poles.contrast.charProfile),
  );

  return {
    rhythm,
    char,
    fused: (rhythm.margin + char.margin) / 2,
    rhythmVector: standardized,
  };
}

function family(voiceDistance: number, contrastDistance: number): FamilyScore {
  return { voiceDistance, contrastDistance, margin: margin(voiceDistance, contrastDistance) };
}

export function percentiles(raw: RawScore, calibration: CalibrationSet): Percentiles {
  return {
    rhythm: percentileOf(calibration.rhythm, raw.rhythm.margin),
    char: percentileOf(calibration.char, raw.char.margin),
    fused: percentileOf(calibration.fused, raw.fused),
  };
}

export function scoreDocument(
  doc: Segmented,
  poles: Poles,
  calibration: CalibrationSet,
): DocumentScore {
  const raw = scoreSegmented(doc, poles);
  return {
    ...raw,
    words: doc.words.length,
    sentences: doc.sentences.length,
    percentile: percentiles(raw, calibration),
  };
}

export interface FeatureDelta {
  id: string;
  // Signed distance from the voice pole, in voice-pole standard deviations.
  deviation: number;
  // Which way the contrast pole sits from the voice pole on this feature.
  contrastDirection: 1 | -1;
}

// A deviation whose sign matches contrastDirection is drift toward the contrast
// pole. The opposite sign is idiosyncrasy, which nothing downstream flags.
export function featureDeltas(raw: RawScore, poles: Poles): FeatureDelta[] {
  return poles.featureIds.map((id, i) => {
    const center = poles.voice.rhythmCentroid[i] ?? 0;
    const sd = poles.voice.rhythmSpread[i] ?? 1;
    const contrastGap = (poles.contrast.rhythmCentroid[i] ?? 0) - center;
    return {
      id,
      deviation: ((raw.rhythmVector[i] ?? 0) - center) / sd,
      contrastDirection: contrastGap >= 0 ? 1 : -1,
    };
  });
}
