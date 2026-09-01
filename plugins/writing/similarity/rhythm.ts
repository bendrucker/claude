// Rates and shape statistics over sentence lengths, comma placement, and
// punctuation, compared by euclidean distance in standardized space. Of the
// families tested this one held up best across genres, and alone among them
// carries no topic signal.
//
// `leading` marks the features that separated the poles with |Cohen's d| >= 0.8.

import { mean, median, quantileOfSorted, standardDeviation } from "./vector";
import { type Segmented, sentenceWordCount } from "./segment";

export interface FeatureDiagnostic {
  high: string;
  low: string;
}

export interface RhythmFeature {
  id: string;
  label: string;
  leading?: boolean;
  diagnostic?: FeatureDiagnostic;
  compute: (doc: Segmented) => number;
}

// Unambiguous contraction suffixes plus the pronoun and adverb hosts where a
// trailing 's is a contraction rather than a possessive.
const CONTRACTION =
  /\b(?:[a-z]+n['’]t|[a-z]+['’](?:re|ve|ll|d|m)|(?:it|that|there|here|what|who|he|she|let|how|where|why|this)['’]s)\b/g;

function rate(count: number, total: number, per: number): number {
  if (total === 0) return 0;
  return (count / total) * per;
}

function occurrences(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function sentenceLengths(doc: Segmented): number[] {
  return doc.sentences.map(sentenceWordCount).filter((length) => length > 0);
}

function commaCounts(doc: Segmented): number[] {
  return doc.sentences.map((sentence) => occurrences(sentence, /,/g));
}

function fraction(values: number[], predicate: (value: number) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(predicate).length / values.length;
}

// Mean absolute difference between consecutive sentence lengths, over the mean.
// Separates prose that alternates long and short from prose whose sentences
// vary overall but stay uniform locally, which the spread features conflate.
function burstiness(lengths: number[]): number {
  if (lengths.length < 2) return 0;
  const average = mean(lengths);
  if (average === 0) return 0;
  let total = 0;
  for (let i = 1; i < lengths.length; i++)
    total += Math.abs((lengths[i] ?? 0) - (lengths[i - 1] ?? 0));
  return total / (lengths.length - 1) / average;
}

// Capped so the ratio does not simply measure document length.
const TYPE_TOKEN_WINDOW = 500;

function typeTokenRatio(words: string[]): number {
  const sample = words.slice(0, TYPE_TOKEN_WINDOW);
  if (sample.length === 0) return 0;
  return new Set(sample).size / sample.length;
}

function midSentenceCapitals(doc: Segmented): number {
  let capitals = 0;
  for (const sentence of doc.sentences) {
    const words = sentence.split(/\s+/).slice(1);
    capitals += words.filter((word) => /^[A-Z][a-z]/.test(word)).length;
  }
  return capitals;
}

export const RHYTHM_FEATURES: RhythmFeature[] = [
  {
    id: "sentenceLengthMean",
    label: "mean sentence length",
    compute: (doc) => mean(sentenceLengths(doc)),
    diagnostic: { high: "sentences run long", low: "sentences run short" },
  },
  {
    id: "sentenceLengthMedian",
    label: "median sentence length",
    compute: (doc) => median(sentenceLengths(doc)),
  },
  {
    id: "sentenceLengthSd",
    label: "sentence length spread",
    compute: (doc) => standardDeviation(sentenceLengths(doc)),
  },
  {
    id: "sentenceLengthCv",
    label: "sentence length variation",
    leading: true,
    diagnostic: {
      high: "sentence lengths swing unusually wide",
      low: "uniform sentence lengths",
    },
    compute: (doc) => {
      const lengths = sentenceLengths(doc);
      const average = mean(lengths);
      return average === 0 ? 0 : standardDeviation(lengths, average) / average;
    },
  },
  {
    id: "shortSentenceFraction",
    label: "short sentences (<10 words)",
    leading: true,
    diagnostic: {
      high: "almost every sentence is clipped",
      low: "no short sentences breaking up the block",
    },
    compute: (doc) => fraction(sentenceLengths(doc), (length) => length < 10),
  },
  {
    id: "longSentenceFraction",
    label: "long sentences (>30 words)",
    diagnostic: { high: "many sentences over 30 words", low: "no long sentences" },
    compute: (doc) => fraction(sentenceLengths(doc), (length) => length > 30),
  },
  {
    id: "sentenceLengthRange",
    label: "sentence length p10-p90 range",
    compute: (doc) => {
      const sorted = sentenceLengths(doc).toSorted((a, b) => a - b);
      return quantileOfSorted(sorted, 0.9) - quantileOfSorted(sorted, 0.1);
    },
  },
  {
    id: "sentenceLengthBurstiness",
    label: "sentence length burstiness",
    compute: (doc) => burstiness(sentenceLengths(doc)),
  },
  {
    id: "commasPerSentence",
    label: "commas per sentence",
    leading: true,
    diagnostic: {
      high: "run-on sentences with many commas",
      low: "no commas subdividing sentences",
    },
    compute: (doc) => mean(commaCounts(doc)),
  },
  {
    id: "commaFreeSentenceFraction",
    label: "comma-free sentences",
    compute: (doc) => fraction(commaCounts(doc), (count) => count === 0),
  },
  {
    id: "multiCommaSentenceFraction",
    label: "sentences with 3+ commas",
    diagnostic: { high: "sentences stacked with three or more commas", low: "" },
    compute: (doc) => fraction(commaCounts(doc), (count) => count >= 3),
  },
  {
    id: "wordsPerClause",
    label: "words per comma-delimited clause",
    compute: (doc) => {
      const commas = commaCounts(doc).reduce((sum, count) => sum + count, 0);
      const clauses = commas + doc.sentences.length;
      return clauses === 0 ? 0 : doc.words.length / clauses;
    },
  },
  {
    id: "contractionRate",
    label: "contractions per 100 words",
    leading: true,
    diagnostic: {
      high: "unusually contraction-heavy",
      low: "low contraction density",
    },
    compute: (doc) =>
      rate(occurrences(doc.prose.toLowerCase(), CONTRACTION), doc.words.length, 100),
  },
  {
    id: "theDensity",
    label: "'the' per 100 words",
    leading: true,
    diagnostic: {
      high: "definite-article heavy",
      low: "few definite articles",
    },
    compute: (doc) =>
      rate(doc.words.filter((word) => word === "the").length, doc.words.length, 100),
  },
  {
    id: "meanWordLength",
    label: "mean word length",
    compute: (doc) => mean(doc.words.map((word) => word.length)),
  },
  {
    id: "longWordFraction",
    label: "words of 8+ characters",
    diagnostic: { high: "long, latinate word choice", low: "" },
    compute: (doc) =>
      fraction(
        doc.words.map((word) => word.length),
        (length) => length >= 8,
      ),
  },
  {
    id: "typeTokenRatio",
    label: "type-token ratio",
    compute: (doc) => typeTokenRatio(doc.words),
  },
  {
    id: "questionRate",
    label: "questions per 100 sentences",
    compute: (doc) => rate(occurrences(doc.prose, /\?/g), doc.sentences.length, 100),
  },
  {
    id: "exclamationRate",
    label: "exclamations per 100 sentences",
    compute: (doc) => rate(occurrences(doc.prose, /!/g), doc.sentences.length, 100),
  },
  {
    id: "semicolonRate",
    label: "semicolons per 1000 words",
    diagnostic: { high: "semicolon splices", low: "" },
    compute: (doc) => rate(occurrences(doc.prose, /;/g), doc.words.length, 1000),
  },
  {
    id: "colonRate",
    label: "colons per 1000 words",
    compute: (doc) => rate(occurrences(doc.prose, /:/g), doc.words.length, 1000),
  },
  {
    id: "dashRate",
    label: "dashes per 1000 words",
    diagnostic: { high: "dash-joined clauses", low: "" },
    compute: (doc) =>
      rate(occurrences(doc.prose, /—|–|(?<=\s)-{1,2}(?=\s)/g), doc.words.length, 1000),
  },
  {
    id: "parenthesisRate",
    label: "parentheticals per 1000 words",
    compute: (doc) => rate(occurrences(doc.prose, /\(/g), doc.words.length, 1000),
  },
  {
    id: "quoteRate",
    label: "quotation marks per 1000 words",
    compute: (doc) => rate(occurrences(doc.prose, /["“”]/g), doc.words.length, 1000),
  },
  {
    id: "apostropheRate",
    label: "apostrophes per 1000 words",
    compute: (doc) => rate(occurrences(doc.prose, /['’]/g), doc.words.length, 1000),
  },
  {
    id: "midSentenceCapitalFraction",
    label: "mid-sentence capitalized words",
    compute: (doc) => rate(midSentenceCapitals(doc), doc.words.length, 100),
  },
  {
    id: "sentencesPerParagraph",
    label: "sentences per paragraph",
    compute: (doc) => mean(doc.paragraphs.map((paragraph) => paragraph.length)),
  },
  {
    id: "singleSentenceParagraphFraction",
    label: "single-sentence paragraphs",
    compute: (doc) =>
      fraction(
        doc.paragraphs.map((paragraph) => paragraph.length),
        (n) => n === 1,
      ),
  },
];

export const RHYTHM_FEATURE_IDS: string[] = RHYTHM_FEATURES.map((feature) => feature.id);

export const LEADING_FEATURE_IDS: string[] = RHYTHM_FEATURES.filter(
  (feature) => feature.leading,
).map((feature) => feature.id);

export function rhythmVector(doc: Segmented): number[] {
  return RHYTHM_FEATURES.map((feature) => feature.compute(doc));
}
