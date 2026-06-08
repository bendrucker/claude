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
import { type CorpusStats, type LiftRow, processCorpus, processRows } from "./ngram";

export interface TagProcessedRows {
  stats: CorpusStats;
  sessionSpread: Map<string, number>;
  /** Shortest corpus sentence seen for each tag sequence. */
  examples: Map<string, string>;
}

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

/** Tag-sequence corpus stats plus session spread and shortest examples. */
export function processTagRows(
  rows: Array<{ session_id: string; text?: string }>,
  sizes: number[] = [3, 4, 5],
  tagger: Tagger = compromiseTagger,
): TagProcessedRows {
  const examples = new Map<string, string>();
  const { stats, sessionSpread } = processRows(rows, sizes, {
    tokenize: (sentence) => tagSequence(sentence, tagger),
    examples,
  });
  return { stats, sessionSpread, examples };
}

/**
 * Tag-sequence corpus stats only, for the baseline corpus where session
 * spread and examples are not needed (mirrors `processCorpus` for words).
 */
export function processTagCorpus(
  text: string,
  sizes: number[] = [3, 4, 5],
  tagger: Tagger = compromiseTagger,
): CorpusStats {
  return processCorpus(text, sizes, (sentence) => tagSequence(sentence, tagger));
}
