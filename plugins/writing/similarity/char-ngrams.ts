// Character 3-gram profiles: the lexical half of the fused score. Spaces are
// retained, so a gram spanning a word boundary carries the rhythm of short
// function words.
//
// Profiles are relative frequencies over the pooled corpus's top grams rather
// than over every gram in the document, which keeps a short window's profile on
// the same scale as a full document's.

import type { Segmented } from "./segment";

export const DEFAULT_VOCABULARY_SIZE = 300;

const GRAM_SIZE = 3;

export function normalizeForGrams(prose: string): string {
  return prose.toLowerCase().replace(/\s+/g, " ").trim();
}

export function countGrams(prose: string, into = new Map<string, number>()): Map<string, number> {
  const text = normalizeForGrams(prose);
  for (let i = 0; i + GRAM_SIZE <= text.length; i++) {
    const gram = text.slice(i, i + GRAM_SIZE);
    into.set(gram, (into.get(gram) ?? 0) + 1);
  }
  return into;
}

// Ties break on the gram itself so a rebuild over the same corpus yields the
// same vocabulary order, and therefore comparable stored profiles.
export function selectVocabulary(counts: Map<string, number>, size: number): string[] {
  return [...counts.entries()]
    .toSorted((a, b) => {
      const byCount = b[1] - a[1];
      return byCount !== 0 ? byCount : a[0].localeCompare(b[0]);
    })
    .slice(0, size)
    .map(([gram]) => gram);
}

export function profileFromCounts(counts: Map<string, number>, vocabulary: string[]): number[] {
  const raw = vocabulary.map((gram) => counts.get(gram) ?? 0);
  const total = raw.reduce((sum, count) => sum + count, 0);
  if (total === 0) return raw;
  return raw.map((count) => count / total);
}

export function charProfile(doc: Segmented, vocabulary: string[]): number[] {
  return profileFromCounts(countGrams(doc.prose), vocabulary);
}
