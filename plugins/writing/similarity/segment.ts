// Stylometric segmentation keeps sentence punctuation, capitalization, and
// apostrophes. The rhythm features are built out of exactly those.

export interface Segmented {
  // Code-, link-, and markup-stripped prose.
  prose: string;
  sentences: string[];
  // Sentences grouped by blank-line-delimited block.
  paragraphs: string[][];
  // Lowercase word tokens, apostrophes retained so contractions count as one.
  words: string[];
}

const STRIP: [RegExp, string][] = [
  [/```[\s\S]*?```/g, " "],
  [/^\s*\|.*\|\s*$/gm, " "],
  [/`[^`\n]*`/g, " "],
  [/!?\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/https?:\/\/\S+/g, " "],
  [/<\/?[a-zA-Z][^>]*>/g, " "],
  [/^\s{0,3}#{1,6}\s+/gm, ""],
  [/^\s*>+\s?/gm, ""],
  [/^\s*(?:[-*+]|\d+[.)])\s+/gm, ""],
  [/^\s*[-*_]{3,}\s*$/gm, " "],
];

// Periods that end one of these do not end a sentence.
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "cf",
  "al",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "fig",
  "no",
  "approx",
  "est",
]);

const TERMINALS = ".!?";

function isTerminal(char: string | undefined): boolean {
  return char !== undefined && TERMINALS.includes(char);
}
const WORD_RE = /[a-z]+(?:['’][a-z]+)*/g;

export function stripMarkup(text: string): string {
  let result = text;
  for (const [pattern, replacement] of STRIP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// A capital before a period is an initial in "B. Drucker" and a lettered label
// in "covers topic A. The next". Only what follows separates them, so a word
// that ordinarily opens a sentence is read as a sentence opening.
const SENTENCE_OPENERS = new Set([
  "a",
  "after",
  "an",
  "and",
  "as",
  "at",
  "before",
  "but",
  "each",
  "every",
  "for",
  "he",
  "here",
  "his",
  "how",
  "i",
  "if",
  "in",
  "it",
  "its",
  "most",
  "no",
  "not",
  "now",
  "once",
  "only",
  "or",
  "our",
  "she",
  "so",
  "some",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "you",
  "your",
]);

function endsWithAbbreviation(chunk: string, rest: string): boolean {
  const match = /([A-Za-z][A-Za-z.]*)\.$/.exec(chunk.trimEnd());
  if (!match) return false;
  const word = match[1] ?? "";
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  if (word.length !== 1 || word !== word.toUpperCase()) return false;
  const following = /^\s*([A-Za-z]+)/.exec(rest)?.[1];
  return following !== undefined && !SENTENCE_OPENERS.has(following.toLowerCase());
}

// Split one line into sentences, keeping terminal punctuation. A line with no
// terminal punctuation is one sentence, which is what makes list items and
// headings count as their own units.
export function splitSentences(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    if (!isTerminal(line[i])) continue;
    let end = i;
    while (isTerminal(line[end + 1])) end++;
    i = end;
    const next = line[end + 1];
    if (next !== undefined && next !== " " && next !== "\t") continue;
    const chunk = line.slice(start, end + 1);
    if (endsWithAbbreviation(chunk, line.slice(end + 1))) continue;
    parts.push(chunk);
    start = end + 1;
  }
  parts.push(line.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function paragraphSentences(block: string): string[] {
  return block.split("\n").flatMap(splitSentences);
}

export function segment(text: string): Segmented {
  const prose = stripMarkup(text);
  const paragraphs = prose
    .split(/\n[ \t]*\n+/)
    .map(paragraphSentences)
    .filter((sentences) => sentences.length > 0);
  return {
    prose,
    sentences: paragraphs.flat(),
    paragraphs,
    words: prose.toLowerCase().match(WORD_RE) ?? [],
  };
}

// Sliding windows go through here so they are not re-stripped, and so window
// and document feature vectors are computed by the same code.
export function fromSentences(sentences: string[]): Segmented {
  const prose = sentences.join(" ");
  return {
    prose,
    sentences,
    paragraphs: [sentences],
    words: prose.toLowerCase().match(WORD_RE) ?? [],
  };
}

export function sentenceWordCount(sentence: string): number {
  return (sentence.toLowerCase().match(WORD_RE) ?? []).length;
}
