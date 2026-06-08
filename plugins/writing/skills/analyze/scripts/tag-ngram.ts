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
