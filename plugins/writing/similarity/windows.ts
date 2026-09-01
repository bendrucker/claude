// Window-level localization: which passages pulled the document score down.
//
// Windows keep the full document feature vector, including the two paragraph
// features that go degenerate over a single window. The corpus windows behind
// the calibration ladder are degenerate the same way, so the two sides match.

import type { Poles, StyleProfile } from "./profile";
import { percentileOf } from "./calibration";
import { RHYTHM_FEATURES } from "./rhythm";
import { featureDeltas, type RawScore, scoreSegmented } from "./score";
import { fromSentences, type Segmented } from "./segment";

export const DEFAULT_WINDOW_SENTENCES = 4;

// A window has to clear the voice pole's spread by this much before its feature
// is named. Below it, short-window noise dominates.
const DIAGNOSTIC_DEVIATION = 1.5;

const MAX_ISSUES_PER_WINDOW = 3;

export interface WindowIssue {
  id: string;
  message: string;
}

export interface WindowScore {
  startSentence: number;
  sentences: string[];
  words: number;
  raw: RawScore;
}

export interface LocalizedWindow extends WindowScore {
  percentile: number;
  issues: WindowIssue[];
  excerpt: string;
}

// Even coverage of a long document under a cap, so its whole span is sampled.
export function stride<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = items.length / limit;
  const picked: T[] = [];
  for (let i = 0; i < limit; i++) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

// A document with fewer sentences than the window yields none, so every sample
// in the calibration ladder covers the same span.
export function slidingWindows(sentences: string[], size: number): string[][] {
  if (size < 1 || sentences.length < size) return [];
  const windows: string[][] = [];
  for (let start = 0; start + size <= sentences.length; start++) {
    windows.push(sentences.slice(start, start + size));
  }
  return windows;
}

// `limit` strides before scoring, so a calibration build over a large corpus
// never scores windows it discards.
export function scoreWindows(
  doc: Segmented,
  poles: Poles,
  size: number,
  limit?: number,
): WindowScore[] {
  const all = slidingWindows(doc.sentences, size).map((sentences, startSentence) => ({
    sentences,
    startSentence,
  }));
  return (limit === undefined ? all : stride(all, limit)).map(({ sentences, startSentence }) => {
    const window = fromSentences(sentences);
    return {
      startSentence,
      sentences,
      words: window.words.length,
      raw: scoreSegmented(window, poles),
    };
  });
}

// Matched on the passage: a four-sentence window is too short for a rate to
// mean anything.
const ANTITHESIS: [RegExp, string][] = [
  [
    /\bnot\s+(?:just|only|merely|simply)\s+[^,.;:]{1,60},?\s+but\b/i,
    "'not just X but Y' antithesis",
  ],
  [/,\s*not\s+[^,.;:]{1,50}[.;]/i, "'X, not Y' antithesis"],
  [
    /\b(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t|doesn['’]t|don['’]t)\s+[^,.;:]{1,50},\s*(?:it['’]s|they['’]re|but|rather)\b/i,
    "'it isn't X, it's Y' antithesis",
  ],
];

function antithesisIssues(passage: string): WindowIssue[] {
  const issues: WindowIssue[] = [];
  for (const [pattern, message] of ANTITHESIS) {
    if (pattern.test(passage)) issues.push({ id: "antithesis", message });
  }
  return issues;
}

const DIAGNOSTICS = new Map(RHYTHM_FEATURES.map((feature) => [feature.id, feature.diagnostic]));

function featureIssues(raw: RawScore, poles: Poles): WindowIssue[] {
  return featureDeltas(raw, poles)
    .filter((delta) => Math.abs(delta.deviation) >= DIAGNOSTIC_DEVIATION)
    .filter((delta) => Math.sign(delta.deviation) === delta.contrastDirection)
    .toSorted((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
    .flatMap((delta) => {
      const diagnostic = DIAGNOSTICS.get(delta.id);
      if (diagnostic === undefined) return [];
      const message = delta.deviation > 0 ? diagnostic.high : diagnostic.low;
      return message === "" ? [] : [{ id: delta.id, message }];
    });
}

// Antithesis first: a match names something concrete in the passage, where a
// feature deviation only says the window sits outside a range.
export function windowIssues(window: WindowScore, poles: Poles): WindowIssue[] {
  const passage = window.sentences.join(" ");
  return [...antithesisIssues(passage), ...featureIssues(window.raw, poles)].slice(
    0,
    MAX_ISSUES_PER_WINDOW,
  );
}

export function localize(doc: Segmented, profile: StyleProfile): LocalizedWindow[] {
  return scoreWindows(doc, profile, profile.windowSentences).map((window) =>
    Object.assign(window, {
      percentile: percentileOf(profile.windowCalibration.fused, window.raw.fused),
      issues: windowIssues(window, profile),
      excerpt: window.sentences.join(" "),
    }),
  );
}

// The percentile is read against the voice corpus's own window distribution,
// which sits well below its document distribution.
export function flagWindows(
  windows: LocalizedWindow[],
  belowPercentile: number,
): LocalizedWindow[] {
  return windows
    .filter((window) => window.percentile < belowPercentile)
    .toSorted((a, b) => a.percentile - b.percentile);
}
