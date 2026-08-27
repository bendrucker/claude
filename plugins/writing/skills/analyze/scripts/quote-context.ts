import { stemmer } from "stemmer";

export interface SourceRow {
  session_id: string;
  source_file?: string | null;
  source_line?: number | null;
  file_path?: string | null;
  text?: string;
}

export interface QuoteContext {
  window: string;
  sourceFile: string | null;
  sourceLine: number | null;
  filePath: string | null;
}

const WORD_TOKEN = /[a-zA-Z]+/g;

// Find the first deliverable occurrence of a phrase and return a context window
// plus a source pointer, so every candidate and audited tell is spot-checkable.
// Tries an exact case-insensitive match first (n-gram candidates), then a
// stemmed-subsequence scan (wordlist tells with inflection like "fails loudly").
export function findQuote(phrase: string, rows: SourceRow[], radius = 60): QuoteContext | null {
  const lowered = phrase.toLowerCase();
  for (const row of rows) {
    if (row.text == null || row.text === "") continue;
    const idx = row.text.toLowerCase().indexOf(lowered);
    if (idx >= 0) return makeContext(row, idx, idx + phrase.length, radius);
  }

  const needle = (lowered.match(WORD_TOKEN) ?? []).map((w) => stemmer(w));
  if (needle.length === 0) return null;
  for (const row of rows) {
    if (row.text == null || row.text === "") continue;
    const span = findStemmedSpan(row.text, needle);
    if (span) return makeContext(row, span.start, span.end, radius);
  }
  return null;
}

interface Span {
  start: number;
  end: number;
}

function findStemmedSpan(text: string, needle: string[]): Span | null {
  const tokens: Array<{ stem: string; start: number; end: number }> = [];
  for (const match of text.matchAll(WORD_TOKEN)) {
    const word = match[0];
    tokens.push({
      stem: stemmer(word.toLowerCase()),
      start: match.index,
      end: match.index + word.length,
    });
  }
  for (let i = 0; i + needle.length <= tokens.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (tokens[i + j]?.stem !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const first = tokens[i];
      const last = tokens[i + needle.length - 1];
      if (first && last) return { start: first.start, end: last.end };
    }
  }
  return null;
}

function makeContext(row: SourceRow, start: number, end: number, radius: number): QuoteContext {
  const from = Math.max(0, start - radius);
  const to = Math.min(row.text?.length ?? 0, end + radius);
  const prefix = from > 0 ? "..." : "";
  const suffix = to < (row.text?.length ?? 0) ? "..." : "";
  const window = `${prefix}${(row.text ?? "").slice(from, to).replace(/\s+/g, " ").trim()}${suffix}`;
  return {
    window,
    sourceFile: row.source_file ?? null,
    sourceLine: row.source_line ?? null,
    filePath: row.file_path ?? null,
  };
}
