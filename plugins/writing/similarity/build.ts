// The standardizer is fitted on both poles pooled. Fitting on one pole alone
// would place that centroid at the origin and give each feature a scale set by
// a single population, leaving the two distances incomparable.

import {
  countGrams,
  DEFAULT_VOCABULARY_SIZE,
  profileFromCounts,
  selectVocabulary,
} from "./char-ngrams";
import { calibrate } from "./calibration";
import {
  type CalibrationSet,
  type Pole,
  type Poles,
  SCHEMA_VERSION,
  type StyleProfile,
} from "./profile";
import { RHYTHM_FEATURE_IDS, rhythmVector } from "./rhythm";
import { scorePrepared } from "./score";
import { type Segmented, segment } from "./segment";
import { centroid, fitScaler, spread, standardize } from "./vector";
import { DEFAULT_WINDOW_SENTENCES, scoreWindows } from "./windows";

export interface CorpusDocument {
  source: string;
  body: string;
}

export interface BuildOptions {
  generatedAt: string;
  vocabularySize?: number | undefined;
  windowSentences?: number | undefined;
  // Documents shorter than this contribute nothing stable to a rate feature.
  minWords?: number | undefined;
  // Cap on windows drawn from any one document, so a single long document does
  // not dominate the window calibration ladder.
  maxWindowsPerDocument?: number | undefined;
}

export interface BuildResult {
  profile: StyleProfile;
  skipped: { voice: number; contrast: number };
}

const DEFAULT_MIN_WORDS = 60;
const DEFAULT_MAX_WINDOWS_PER_DOCUMENT = 12;

// Zero or a negative would build a profile that validates but scores on an
// empty vocabulary or an unfloored corpus.
function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

interface PreparedDocument {
  source: string;
  segmented: Segmented;
  rhythm: number[];
  grams: Map<string, number>;
}

function prepare(
  documents: CorpusDocument[],
  minWords: number,
  minSentences: number,
): PreparedDocument[] {
  const prepared: PreparedDocument[] = [];
  for (const document of documents) {
    const segmented = segment(document.body);
    if (segmented.words.length < minWords || segmented.sentences.length < minSentences) continue;
    prepared.push({
      source: document.source,
      segmented,
      rhythm: rhythmVector(segmented),
      grams: countGrams(segmented.prose),
    });
  }
  return prepared;
}

function mergeGrams(documents: PreparedDocument[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const document of documents) {
    for (const [gram, count] of document.grams) total.set(gram, (total.get(gram) ?? 0) + count);
  }
  return total;
}

function buildPole(
  documents: PreparedDocument[],
  standardizedRows: number[][],
  vocabulary: string[],
): Pole {
  return {
    documentCount: documents.length,
    wordCount: documents.reduce((sum, document) => sum + document.segmented.words.length, 0),
    rhythmCentroid: centroid(standardizedRows),
    rhythmSpread: spread(standardizedRows),
    charProfile: profileFromCounts(mergeGrams(documents), vocabulary),
    sources: [...new Set(documents.map((document) => document.source))].toSorted(),
  };
}

function calibrationSet(rhythm: number[], char: number[], fused: number[]): CalibrationSet {
  return { rhythm: calibrate(rhythm), char: calibrate(char), fused: calibrate(fused) };
}

export function buildStyleProfile(
  voice: CorpusDocument[],
  contrast: CorpusDocument[],
  options: BuildOptions,
): BuildResult {
  const minWords = positiveInteger("minWords", options.minWords ?? DEFAULT_MIN_WORDS);
  const windowSentences = positiveInteger(
    "windowSentences",
    options.windowSentences ?? DEFAULT_WINDOW_SENTENCES,
  );
  const maxWindows = positiveInteger(
    "maxWindowsPerDocument",
    options.maxWindowsPerDocument ?? DEFAULT_MAX_WINDOWS_PER_DOCUMENT,
  );
  const vocabularySize = positiveInteger(
    "vocabularySize",
    options.vocabularySize ?? DEFAULT_VOCABULARY_SIZE,
  );

  const voiceDocuments = prepare(voice, minWords, windowSentences);
  const contrastDocuments = prepare(contrast, minWords, windowSentences);
  if (voiceDocuments.length === 0) throw new Error("No voice documents cleared the length floor");
  if (contrastDocuments.length === 0) {
    throw new Error("No contrast documents cleared the length floor");
  }

  const scaler = fitScaler([...voiceDocuments, ...contrastDocuments].map((d) => d.rhythm));
  const vocabulary = selectVocabulary(
    mergeGrams([...voiceDocuments, ...contrastDocuments]),
    vocabularySize,
  );

  const poles: Poles = {
    featureIds: RHYTHM_FEATURE_IDS,
    scaler,
    charVocabulary: vocabulary,
    voice: buildPole(
      voiceDocuments,
      voiceDocuments.map((d) => standardize(d.rhythm, scaler)),
      vocabulary,
    ),
    contrast: buildPole(
      contrastDocuments,
      contrastDocuments.map((d) => standardize(d.rhythm, scaler)),
      vocabulary,
    ),
  };

  const documentScores = voiceDocuments.map((d) =>
    scorePrepared(standardize(d.rhythm, scaler), d.grams, poles),
  );
  const windowScores = voiceDocuments.flatMap((d) =>
    scoreWindows(d.segmented, poles, windowSentences, maxWindows),
  );

  return {
    profile: {
      ...poles,
      version: SCHEMA_VERSION,
      generatedAt: options.generatedAt,
      windowSentences,
      documentCalibration: calibrationSet(
        documentScores.map((score) => score.rhythm.margin),
        documentScores.map((score) => score.char.margin),
        documentScores.map((score) => score.fused),
      ),
      windowCalibration: calibrationSet(
        windowScores.map((window) => window.raw.rhythm.margin),
        windowScores.map((window) => window.raw.char.margin),
        windowScores.map((window) => window.raw.fused),
      ),
    },
    skipped: {
      voice: voice.length - voiceDocuments.length,
      contrast: contrast.length - contrastDocuments.length,
    },
  };
}
