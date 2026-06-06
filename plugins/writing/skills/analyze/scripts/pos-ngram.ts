/**
 * POS-tag-sequence lift: the word-independent analogue of the n-gram
 * candidate miner. Each sentence is tagged with the compromise adapter,
 * mapped to coarse tags, and the tag sequences ("COPULA PARTICIPLE ADP")
 * feed the same lift math as word n-grams. Vocabulary tells drift with
 * model releases; the structural shape of a habit persists, so these
 * signatures survive the drift that invalidates wordlists.
 */
import { compromiseTagger } from "../../../linguistics/compromise";
import type { Tagger } from "../../../linguistics/tagger";
import { addNgrams, type CorpusStats, cleanText, type LiftRow, splitSentences } from "./ngram";

export interface PosProcessedRows {
  stats: CorpusStats;
  sessionSpread: Map<string, number>;
  /** Shortest corpus sentence seen for each tag sequence. */
  examples: Map<string, string>;
}

export interface PosSignatureRow extends LiftRow {
  example: string | null;
}

/**
 * Tag a sentence and return its coarse tag sequence. Punctuation and
 * unknown tokens are dropped, matching the word tokenizer, so tag
 * sequences and word n-grams describe the same token stream.
 */
export function tagSequence(sentence: string, tagger: Tagger = compromiseTagger): string[] {
  return tagger
    .tag(sentence)
    .flatMap((tagged) => tagged.tokens)
    .filter((token) => token.tag !== "PUNCT" && token.tag !== "X")
    .map((token) => token.tag);
}

export function processPosRows(
  rows: Array<{ session_id: string; text?: string }>,
  sizes: number[] = [3, 4, 5],
  tagger: Tagger = compromiseTagger,
): PosProcessedRows {
  const stats: CorpusStats = {
    tokens: 0,
    ngrams: new Map(sizes.map((n) => [n, new Map<string, number>()])),
  };
  const keySessions = new Map<string, Set<string>>();
  const examples = new Map<string, string>();

  for (const row of rows) {
    if (!row.text) continue;
    for (const sentence of splitSentences(cleanText(row.text))) {
      const tags = tagSequence(sentence, tagger);
      if (tags.length === 0) continue;
      stats.tokens += tags.length;
      for (const n of sizes) {
        const counts = stats.ngrams.get(n);
        if (!counts) continue;
        addNgrams(counts, tags, n);
        for (let i = 0; i <= tags.length - n; i++) {
          const key = tags.slice(i, i + n).join(" ");
          let sessions = keySessions.get(key);
          if (!sessions) {
            sessions = new Set();
            keySessions.set(key, sessions);
          }
          sessions.add(row.session_id);
          const existing = examples.get(key);
          if (!existing || sentence.length < existing.length) {
            examples.set(key, sentence);
          }
        }
      }
    }
  }

  const sessionSpread = new Map<string, number>();
  for (const [key, sessions] of keySessions) {
    sessionSpread.set(key, sessions.size);
  }
  return { stats, sessionSpread, examples };
}
