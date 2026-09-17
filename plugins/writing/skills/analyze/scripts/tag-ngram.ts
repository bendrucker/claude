/**
 * Part-of-speech tag-sequence lift: the word-independent analogue of the
 * n-gram candidate miner. Each sentence is tagged with the compromise
 * adapter, mapped to coarse tags, and the tag sequences ("COPULA
 * PARTICIPLE ADP") feed the same lift math as word n-grams. Vocabulary
 * tells drift with model releases; the structural shape of a habit
 * persists, so these signatures survive the drift that invalidates
 * wordlists. Punctuation is dropped, so this is the part-of-speech layer
 * (word types only), not syntax.
 */
import { compromiseTagger } from "../../../linguistics/compromise";
import type { Tagger } from "../../../linguistics/tagger";
import type { LiftRow } from "./ngram";

export interface TagSignatureRow extends LiftRow {
  example: string | null;
}

/**
 * Tag a sentence and return its coarse tag sequence, dropping punctuation
 * and unknown tokens. This is the part-of-speech analogue of
 * `tokenizeSentence`: it plugs into the same `processRows`/`processCorpus`
 * pipeline as the word tokenizer, so the lift math is shared.
 */
export function tagSequence(sentence: string, tagger: Tagger = compromiseTagger): string[] {
  return tagger
    .tag(sentence)
    .flatMap((tagged) => tagged.tokens)
    .filter((token) => token.tag !== "PUNCT" && token.tag !== "X")
    .map((token) => token.tag);
}

export interface ShapeMatch {
  /** Tag n-grams landing on one of the shapes. */
  hits: number;
  /** Tag n-grams the document offered at the measured sizes. */
  total: number;
  /** Hit count per shape, largest first, omitting shapes the document never used. */
  byShape: { shape: string; count: number }[];
}

/**
 * The hit share is the reportable number: a corpus separates on how often these
 * shapes recur, and one occurrence in one document distinguishes nothing.
 */
export function matchShapes(
  sentences: string[],
  sizes: number[],
  shapes: Set<string>,
  tag: (sentence: string) => string[] = tagSequence,
): ShapeMatch {
  const counts = new Map<string, number>();
  let hits = 0;
  let total = 0;
  for (const sentence of sentences) {
    const tags = tag(sentence);
    for (const n of sizes) {
      for (let start = 0; start + n <= tags.length; start++) {
        total += 1;
        const shape = tags.slice(start, start + n).join(" ");
        if (!shapes.has(shape)) continue;
        hits += 1;
        counts.set(shape, (counts.get(shape) ?? 0) + 1);
      }
    }
  }
  const byShape = [...counts.entries()]
    .map(([shape, count]) => ({ shape, count }))
    .toSorted((a, b) => (b.count === a.count ? a.shape.localeCompare(b.shape) : b.count - a.count));
  return { hits, total, byShape };
}
