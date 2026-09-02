// Stylometric segmentation keeps sentence punctuation, capitalization, and
// apostrophes. The rhythm features are built out of exactly those.
//
// Sentence boundaries and contractions come from compromise. Its lexicon
// resolves abbreviations and initials, and its tagger separates a clitic 's
// from a possessive one, so neither needs a word list here.

import nlp from "compromise";
import { z } from "zod";

export interface Sentence {
  text: string;
  // Word tokens, so a window never re-tokenizes its sentences.
  words: number;
  contractions: number;
}

export interface Segmented {
  // Code-, link-, and markup-stripped prose.
  prose: string;
  sentences: Sentence[];
  // Sentences grouped by blank-line-delimited block.
  paragraphs: Sentence[][];
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

const WORD_RE = /[a-z]+(?:['’][a-z]+)*/g;

export function stripMarkup(text: string): string {
  let result = text;
  for (const [pattern, replacement] of STRIP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

const ParsedTerm = z.object({ text: z.string(), implicit: z.string().optional() });
type ParsedTerm = z.infer<typeof ParsedTerm>;

const ParsedSentences = z.array(z.object({ text: z.string(), terms: z.array(ParsedTerm) }));

// A contraction is split into terms carrying `implicit` expansions, and only
// the head term keeps the surface text.
function isContraction(term: ParsedTerm): boolean {
  return term.implicit !== undefined && term.text !== "";
}

// A line break is a sentence boundary, which is what makes list items and
// headings count as their own units.
export function splitSentences(block: string): Sentence[] {
  return ParsedSentences.parse(nlp(block).fullSentences().json())
    .map((sentence) => ({
      text: sentence.text.trim(),
      words: tokenize(sentence.text).length,
      contractions: sentence.terms.filter(isContraction).length,
    }))
    .filter((sentence) => sentence.text !== "");
}

export function segment(text: string): Segmented {
  const prose = stripMarkup(text);
  const paragraphs = prose
    .split(/\n[ \t]*\n+/)
    .map(splitSentences)
    .filter((sentences) => sentences.length > 0);
  return {
    prose,
    sentences: paragraphs.flat(),
    paragraphs,
    words: tokenize(prose),
  };
}

// Sliding windows go through here so they are not re-parsed, and so window
// and document feature vectors are computed by the same code.
export function fromSentences(sentences: Sentence[]): Segmented {
  const prose = sentences.map((sentence) => sentence.text).join(" ");
  return {
    prose,
    sentences,
    paragraphs: [sentences],
    words: tokenize(prose),
  };
}
