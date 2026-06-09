import { join } from "node:path";
import { stemmer } from "stemmer";

export type Hits = { count: number; sample: string };
export type WeightedHits = { totalWeight: number; samples: string[] };

export type PlainWordlistOptions = {
  flags?: string;
  prefix?: string;
  suffix?: string;
};

const COMMENT_OR_BLANK = /^\s*(?:#|$)/;
const WORD_TOKEN = /[a-zA-Z]+/g;

// Count word tokens the same way the wordlist matchers tokenize, so a per-token
// density measured against this count lines up with what the matchers see.
export function countWords(text: string): number {
  return text.match(WORD_TOKEN)?.length ?? 0;
}

function parseLines(content: string): string[] {
  const lines: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    if (COMMENT_OR_BLANK.test(raw)) continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }
  return lines;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compilePlainWordlist(
  content: string,
  options: PlainWordlistOptions = {},
): RegExp | null {
  const entries = parseLines(content);
  if (entries.length === 0) return null;
  const fragments = Array.from(new Set(entries.map(escapeRegex)));
  const prefix = options.prefix ?? "\\b";
  const suffix = options.suffix ?? "\\b";
  const flags = options.flags ?? "gi";
  return new RegExp(`${prefix}(?:${fragments.join("|")})${suffix}`, flags);
}

export function compileStemmedWordlist(content: string): (text: string) => Hits {
  const stems = new Set<string>();
  for (const entry of parseLines(content)) {
    for (const word of entry.toLowerCase().match(WORD_TOKEN) ?? []) {
      stems.add(stemmer(word));
    }
  }
  return (text: string): Hits => {
    const words = text.match(WORD_TOKEN) ?? [];
    let count = 0;
    let sample = "";
    for (const word of words) {
      if (stems.has(stemmer(word.toLowerCase()))) {
        count++;
        if (!sample) sample = word;
      }
    }
    return { count, sample };
  };
}

const WEIGHTED_LINE = /^(\S+)\s+([0-9]+(?:\.[0-9]+)?)$/;

export type StemmedWeight = { stem: string; weight: number; original: string };

export function compileWeightedStems(content: string): StemmedWeight[] {
  const entries: StemmedWeight[] = [];
  for (const line of parseLines(content)) {
    const match = WEIGHTED_LINE.exec(line);
    if (!match) {
      throw new Error(`Invalid weighted wordlist entry: ${line}`);
    }
    const entry = match[1] ?? "";
    const weight = Number.parseFloat(match[2] ?? "0");
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Invalid weight in entry: ${line}`);
    }
    entries.push({
      stem: stemmer(entry.toLowerCase()),
      weight,
      original: entry,
    });
  }
  return entries;
}

export type StemmedPhrase = { stems: string[]; original: string };

export function compileStemmedPhrases(content: string): StemmedPhrase[] {
  const phrases: StemmedPhrase[] = [];
  for (const line of parseLines(content)) {
    const stems = (line.toLowerCase().match(WORD_TOKEN) ?? []).map((word) => stemmer(word));
    if (stems.length > 0) phrases.push({ stems, original: line });
  }
  return phrases;
}

// Count contiguous occurrences of `needle` within `haystack` (non-overlapping).
function countSubsequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      count++;
      i += needle.length - 1;
    }
  }
  return count;
}

export function stemmedPhraseHits(text: string, phrases: StemmedPhrase[]): Hits {
  const tokens = (text.toLowerCase().match(WORD_TOKEN) ?? []).map((word) => stemmer(word));
  let count = 0;
  let sample = "";
  for (const phrase of phrases) {
    const occurrences = countSubsequence(tokens, phrase.stems);
    if (occurrences === 0) continue;
    count += occurrences;
    if (!sample) sample = phrase.original;
  }
  return { count, sample };
}

export function weightedStemHits(text: string, entries: StemmedWeight[]): WeightedHits {
  const words = text.match(WORD_TOKEN) ?? [];
  const stemCounts = new Map<string, number>();
  for (const word of words) {
    const stem = stemmer(word.toLowerCase());
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }

  let totalWeight = 0;
  const samples: string[] = [];
  for (const entry of entries) {
    const count = stemCounts.get(entry.stem) ?? 0;
    if (count === 0) continue;
    totalWeight += count * entry.weight;
    if (samples.length < 3) samples.push(entry.original);
  }
  return { totalWeight, samples };
}

const WORDLISTS_DIR = join(import.meta.dirname, "..", "wordlists");

async function readWordlist(name: string): Promise<string> {
  return Bun.file(join(WORDLISTS_DIR, name)).text();
}

export type LoadedWordlists = {
  vocabulary: (text: string) => Hits;
  openers: RegExp;
  marketingVerbs: StemmedWeight[];
  softPhrasing: StemmedWeight[];
  floweryPhrases: StemmedPhrase[];
};

async function load(): Promise<LoadedWordlists> {
  const [vocabularySrc, openersSrc, marketingSrc, softSrc, flowerySrc] = await Promise.all([
    readWordlist("vocabulary.txt"),
    readWordlist("openers.txt"),
    readWordlist("marketing-verbs.txt"),
    readWordlist("soft-phrasing.txt"),
    readWordlist("flowery-phrases.txt"),
  ]);

  const vocabulary = compileStemmedWordlist(vocabularySrc);

  const openers = compilePlainWordlist(openersSrc, {
    prefix: "^\\s*",
    suffix: "(?=[.!,])",
    flags: "gm",
  });
  if (!openers) throw new Error("openers.txt produced no entries");

  const marketingVerbs = compileWeightedStems(marketingSrc);
  const softPhrasing = compileWeightedStems(softSrc);
  const floweryPhrases = compileStemmedPhrases(flowerySrc);

  return { vocabulary, openers, marketingVerbs, softPhrasing, floweryPhrases };
}

export const WORDLISTS: LoadedWordlists = await load();
