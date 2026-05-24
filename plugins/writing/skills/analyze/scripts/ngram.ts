const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;
const URL = /https?:\/\/\S+/g;
const PATH_LIKE = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g;
const HTML_TAG = /<[^>]+>/g;
const QUOTED = /^\s*>.*$/gm;
const TABLE_LINE = /^.*\|.*\|.*\|.*$/gm;
const HEADER = /^#{1,6}\s.*$/gm;
const CAMEL = /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/g;
const SNAKE = /\b[a-z]+_[a-z_]+\b/g;
const FUNC_CALL = /\b[a-zA-Z_][a-zA-Z0-9_]*\(/g;
const FLAG = /(?<=\s|^)-{1,2}[a-zA-Z][a-zA-Z0-9-]*/g;

const WORD_RE = /[a-z][a-z'-]*/g;
const SENTENCE_BREAK = /[.!?\n]+/;

export function cleanText(text: string): string {
  return text
    .replace(FENCED_CODE, " ")
    .replace(INLINE_CODE, " ")
    .replace(URL, " ")
    .replace(QUOTED, " ")
    .replace(HTML_TAG, " ")
    .replace(TABLE_LINE, " ")
    .replace(HEADER, " ")
    .replace(PATH_LIKE, " ")
    .replace(FLAG, " ")
    .replace(FUNC_CALL, " ")
    .replace(SNAKE, " ")
    .replace(CAMEL, " ");
}

export function* splitSentences(text: string): Generator<string> {
  for (const sent of text.split(SENTENCE_BREAK)) {
    const trimmed = sent.trim();
    if (trimmed.length > 0) yield trimmed;
  }
}

export function tokenizeSentence(sentence: string): string[] {
  return sentence.toLowerCase().match(WORD_RE) ?? [];
}

export type NGramCounts = Map<string, number>;

export function addNgrams(counts: NGramCounts, tokens: string[], n: number): void {
  if (tokens.length < n) return;
  for (let i = 0; i <= tokens.length - n; i++) {
    const key = tokens.slice(i, i + n).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

export interface CorpusStats {
  tokens: number;
  sentences: number;
  rawChars: number;
  cleanChars: number;
  ngrams: Map<number, NGramCounts>;
}

export function processCorpus(text: string, sizes: number[] = [2, 3, 4]): CorpusStats {
  const cleaned = cleanText(text);
  const stats: CorpusStats = {
    tokens: 0,
    sentences: 0,
    rawChars: text.length,
    cleanChars: cleaned.length,
    ngrams: new Map(sizes.map((n) => [n, new Map<string, number>()])),
  };
  for (const sent of splitSentences(cleaned)) {
    const tokens = tokenizeSentence(sent);
    if (tokens.length === 0) continue;
    stats.sentences += 1;
    stats.tokens += tokens.length;
    for (const n of sizes) {
      const counts = stats.ngrams.get(n);
      if (counts) addNgrams(counts, tokens, n);
    }
  }
  return stats;
}

export function perMillion(count: number, total: number): number {
  if (total === 0) return 0;
  return (count / total) * 1_000_000;
}

export interface LiftRow {
  phrase: string;
  n: number;
  assistantCount: number;
  userCount: number;
  assistantPerM: number;
  userPerM: number;
  lift: number;
}

export interface LiftInput {
  assistant: CorpusStats;
  user: CorpusStats;
  minAssistantCount: Record<number, number>;
}

export function computeLift({ assistant, user, minAssistantCount }: LiftInput): LiftRow[] {
  const rows: LiftRow[] = [];
  for (const [n, assistantNgrams] of assistant.ngrams) {
    const userNgrams = user.ngrams.get(n) ?? new Map<string, number>();
    const min = minAssistantCount[n] ?? 1;
    for (const [phrase, count] of assistantNgrams) {
      if (count < min) continue;
      const userCount = userNgrams.get(phrase) ?? 0;
      const assistantPerM = perMillion(count, assistant.tokens);
      const userPerM = perMillion(userCount, user.tokens);
      rows.push({
        phrase,
        n,
        assistantCount: count,
        userCount,
        assistantPerM,
        userPerM,
        lift: assistantPerM / Math.max(userPerM, 1),
      });
    }
  }
  rows.sort((a, b) => b.lift - a.lift);
  return rows;
}

export function filterByMinLift(rows: LiftRow[], minLift: number): LiftRow[] {
  return rows.filter((r) => r.lift >= minLift);
}

export function excludePhrases(rows: LiftRow[], excluded: Set<string>): LiftRow[] {
  const lower = new Set(Array.from(excluded, (p) => p.toLowerCase().trim()));
  return rows.filter((r) => {
    const phrase = r.phrase.toLowerCase().trim();
    if (lower.has(phrase)) return false;
    for (const ex of lower) {
      if (phrase.includes(ex)) return false;
    }
    return true;
  });
}
