const STRIP_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // fenced code
  /`[^`]+`/g, // inline code
  /https?:\/\/\S+/g, // URLs
  /^\s*>.*$/gm, // blockquotes
  /<[^>]+>/g, // HTML tags
  /^.*\|.*\|.*\|.*$/gm, // table lines
  /^#{1,6}\s.*$/gm, // headers
  /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g, // paths
  /(?<=\s|^)-{1,2}[a-zA-Z][a-zA-Z0-9-]*/g, // CLI flags
  /\b[a-zA-Z_][a-zA-Z0-9_]*\(/g, // function calls
  /\b[a-z]+_[a-z_]+\b/g, // snake_case
  /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/g, // camelCase/PascalCase
];

const WORD_RE = /[a-z][a-z'-]*/g;
const SENTENCE_BREAK = /[.!?\n]+/;

// cleanText: aggressively strip non-prose tokens before n-gram mining.
//
// Contract: removes fenced code blocks, inline code, URLs, blockquotes, HTML
// tags, table lines, headers, file paths, CLI flags, function calls,
// snake_case, and CamelCase identifiers. Position accuracy is not preserved.
// Use for corpus mining where noise suppression matters more than fidelity.
//
// Compare stripCode (detection/tropes.ts): a minimal pipeline that only removes
// fenced blocks and inline code while preserving line and column offsets for
// position-accurate source mapping. Use that for the hook and scan paths.
export function cleanText(text: string): string {
  let result = text;
  for (const pattern of STRIP_PATTERNS) {
    result = result.replace(pattern, " ");
  }
  return result;
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
  for (let i = 0; i <= tokens.length - n; i++) {
    const key = tokens.slice(i, i + n).join(" ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

export interface CorpusStats {
  tokens: number;
  ngrams: Map<number, NGramCounts>;
}

export function processCorpus(
  text: string,
  sizes: number[] = [2, 3, 4],
  tokenize: (sentence: string) => string[] = tokenizeSentence,
): CorpusStats {
  const cleaned = cleanText(text);
  const stats: CorpusStats = {
    tokens: 0,
    ngrams: new Map(sizes.map((n) => [n, new Map<string, number>()])),
  };
  for (const sent of splitSentences(cleaned)) {
    const tokens = tokenize(sent);
    if (tokens.length === 0) continue;
    stats.tokens += tokens.length;
    for (const n of sizes) {
      const counts = stats.ngrams.get(n);
      if (counts) addNgrams(counts, tokens, n);
    }
  }
  return stats;
}

function perMillion(count: number, total: number): number {
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
  sessions?: number;
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
      const smoothedUserPerM = user.tokens > 0 ? userPerM + perMillion(1, user.tokens) : 1;
      rows.push({
        phrase,
        n,
        assistantCount: count,
        userCount,
        assistantPerM,
        userPerM,
        lift: assistantPerM / smoothedUserPerM,
      });
    }
  }
  rows.sort((a, b) => b.lift - a.lift);
  return rows;
}

export interface ProcessedRows {
  stats: CorpusStats;
  sessionSpread: Map<string, number>;
}

export interface ProcessRowsOptions {
  /** Tokenizer for each sentence; defaults to the word tokenizer. */
  tokenize?: (sentence: string) => string[];
  /**
   * When provided, records the shortest sentence seen for each n-gram key.
   * Mutated in place so callers that need examples can read them after.
   */
  examples?: Map<string, string>;
}

export function processRows(
  rows: Array<{ session_id: string; text?: string }>,
  sizes: number[] = [2, 3, 4],
  options: ProcessRowsOptions = {},
): ProcessedRows {
  const tokenize = options.tokenize ?? tokenizeSentence;
  const { examples } = options;
  const stats: CorpusStats = {
    tokens: 0,
    ngrams: new Map(sizes.map((n) => [n, new Map<string, number>()])),
  };
  const phraseSessions = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.text == null || row.text === "") continue;
    for (const sent of splitSentences(cleanText(row.text))) {
      const tokens = tokenize(sent);
      if (tokens.length === 0) continue;
      stats.tokens += tokens.length;
      for (const n of sizes) {
        const counts = stats.ngrams.get(n);
        if (!counts) continue;
        addNgrams(counts, tokens, n);
        for (let i = 0; i <= tokens.length - n; i++) {
          const key = tokens.slice(i, i + n).join(" ");
          let sessions = phraseSessions.get(key);
          if (!sessions) {
            sessions = new Set();
            phraseSessions.set(key, sessions);
          }
          sessions.add(row.session_id);
          if (examples) {
            const existing = examples.get(key);
            if (existing == null || existing === "" || sent.length < existing.length)
              examples.set(key, sent);
          }
        }
      }
    }
  }
  const sessionSpread = new Map<string, number>();
  for (const [phrase, sessions] of phraseSessions) {
    sessionSpread.set(phrase, sessions.size);
  }
  return { stats, sessionSpread };
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
