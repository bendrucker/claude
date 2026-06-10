/**
 * Tricolon detector: three consecutive sentences whose coarse POS shapes
 * are near-identical, the escalating-triad structure from linguistics.md.
 *
 * This module imports the compromise tagger adapter, so only batch tooling
 * (scan, score, analyze) may import it, never hooks. Same wall as
 * classifiers.ts: hooks stay deterministic with zero tagger imports.
 */
import { splitSentences } from "../detection/sentences";
import type { PatternDef } from "../detection/tropes";
import type { Hits } from "../detection/wordlists";
import { compromiseTagger } from "./compromise";
import type { CoarseTag } from "./tags";

// Each sentence in a triple needs this many tokens after tag filtering;
// shorter sentences converge on the same shapes by chance.
const TRICOLON_MIN_TOKENS = 6;
// Normalized edit distance at or below this counts as parallel.
// Literature heuristic. Session-corpus calibration pending per #769.
const TRICOLON_DISTANCE_THRESHOLD = 0.35;

// Determiners, punctuation, and numbers carry no parallelism signal:
// "the parser" and "a router" share a shape regardless of the article.
const SHAPE_NEUTRAL_TAGS: ReadonlySet<CoarseTag> = new Set(["DET", "PUNCT", "NUM"]);

/** Coarse POS shape of a sentence with shape-neutral tags removed. */
export function tagShape(sentence: string): CoarseTag[] {
  return compromiseTagger
    .tag(sentence)
    .flatMap((tagged) => tagged.tokens)
    .map((token) => token.tag)
    .filter((tag) => !SHAPE_NEUTRAL_TAGS.has(tag));
}

function editDistance(a: CoarseTag[], b: CoarseTag[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** Edit distance between two tag sequences, normalized to [0, 1] by the longer length. */
export function normalizedDistance(a: CoarseTag[], b: CoarseTag[]): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return editDistance(a, b) / longest;
}

// A tricolon requires all three pairwise distances under the threshold,
// not just adjacent pairs: adjacent-only would pass a drifting sequence
// where the outer sentences share no structure.
function isParallelTriple(a: CoarseTag[], b: CoarseTag[], c: CoarseTag[]): boolean {
  return [normalizedDistance(a, b), normalizedDistance(b, c), normalizedDistance(a, c)].every(
    (distance) => distance <= TRICOLON_DISTANCE_THRESHOLD,
  );
}

export function tricolonHits(text: string): Hits {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return { count: 0, sample: "" };
  const shapes = sentences.map(tagShape);
  for (let i = 0; i + 2 < sentences.length; i++) {
    const a = shapes[i] as CoarseTag[];
    const b = shapes[i + 1] as CoarseTag[];
    const c = shapes[i + 2] as CoarseTag[];
    if (Math.min(a.length, b.length, c.length) < TRICOLON_MIN_TOKENS) continue;
    if (!isParallelTriple(a, b, c)) continue;
    const sample = sentences
      .slice(i, i + 3)
      .map((sentence) => sentence.slice(0, 40))
      .join(" / ");
    return { count: 1, sample };
  }
  return { count: 0, sample: "" };
}

export const TRICOLON_PATTERN: PatternDef = {
  tier: "context",
  layer: "cross-sentence",
  category: "tricolon",
  fileOnly: true,
  test: tricolonHits,
  message: (matched) =>
    `Tricolon: three consecutive sentences share the same grammatical shape ("${matched}"). Rhythmic triads are an AI prose pattern. Vary the structure or merge the sentences.`,
  positives: [
    "The parser validates the incoming request payload quickly. The router dispatches the matching handler function cleanly. The logger records the final response status faithfully.",
    "It reads the config file from disk at startup. It opens the network socket to the broker at boot. It starts the worker pool for the queue at launch.",
  ],
  negatives: [
    // Parallel shapes, but each sentence is under the 6-token gate.
    "The cache starts cold. The queue fills fast. The worker drains it.",
    // 6+ tokens each, but the shapes diverge.
    "The cache begins cold on the first request of the day. Entries accumulate as traffic arrives, and reads accelerate once the working set stabilizes. Nobody should tune anything before measuring real production load.",
  ],
  evidence:
    "Literature heuristic. Session-corpus calibration pending per the #769 labeling protocol. Normalized edit distance over coarse POS shapes (DET/PUNCT/NUM filtered), threshold 0.35, 6+ tokens per sentence. Batch-only: this module imports the compromise tagger, so hooks never load it.",
  retire:
    "Remove if the labeled eval pass shows precision below the batch bar, or recalibrate the threshold if the session corpus places parallel triads elsewhere. Remove outright if assistant deliverables stop producing tricolons.",
};
