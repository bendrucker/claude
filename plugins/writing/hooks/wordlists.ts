import { join } from "node:path";

export type WeightedPattern = {
  pattern: RegExp;
  weight: number;
};

export type PlainWordlistOptions = {
  flags?: string;
  prefix?: string;
  suffix?: string;
};

const COMMENT_OR_BLANK = /^\s*(?:#|$)/;

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

// Convert a wordlist entry like `meticulous(ly)` or `underscore(s|d)` into a
// regex fragment. A bare `(...)` group is treated as optional, so
// `meticulous(ly)` becomes `meticulous(?:ly)?` and `underscore(s|d)` becomes
// `underscore(?:s|d)?`. Escape everything else literally.
export function entryToFragment(entry: string): string {
  const match = entry.match(/^([^()]+)(?:\(([^()]+)\))?$/);
  if (!match) {
    return escapeRegex(entry);
  }
  const stem = escapeRegex(match[1] ?? "");
  const suffixes = match[2];
  if (!suffixes) return stem;
  const alternates = suffixes.split("|").map((s) => escapeRegex(s));
  return `${stem}(?:${alternates.join("|")})?`;
}

export function compilePlainWordlist(
  content: string,
  options: PlainWordlistOptions = {},
): RegExp | null {
  const entries = parseLines(content);
  if (entries.length === 0) return null;
  const fragments = Array.from(new Set(entries.map(entryToFragment)));
  const prefix = options.prefix ?? "\\b";
  const suffix = options.suffix ?? "\\b";
  const flags = options.flags ?? "gi";
  return new RegExp(`${prefix}(?:${fragments.join("|")})${suffix}`, flags);
}

const WEIGHTED_LINE = /^(\S+)\s+([0-9]+(?:\.[0-9]+)?)$/;

export function compileWeightedWordlist(content: string): WeightedPattern[] {
  const patterns: WeightedPattern[] = [];
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
    patterns.push({
      pattern: new RegExp(`\\b${entryToFragment(entry)}\\b`, "gi"),
      weight,
    });
  }
  return patterns;
}

const WORDLISTS_DIR = join(import.meta.dirname, "..", "wordlists");

async function readWordlist(name: string): Promise<string> {
  return Bun.file(join(WORDLISTS_DIR, name)).text();
}

export type LoadedWordlists = {
  vocabulary: RegExp;
  openers: RegExp;
  letMeVerbs: RegExp;
  marketingVerbs: WeightedPattern[];
};

async function load(): Promise<LoadedWordlists> {
  const [vocabularySrc, openersSrc, letMeVerbsSrc, marketingSrc] = await Promise.all([
    readWordlist("vocabulary.txt"),
    readWordlist("openers.txt"),
    readWordlist("let-me-verbs.txt"),
    readWordlist("marketing-verbs.txt"),
  ]);

  const vocabulary = compilePlainWordlist(vocabularySrc);
  if (!vocabulary) throw new Error("vocabulary.txt produced no entries");

  // Openers match at the start of a line (after optional whitespace) followed
  // by terminal punctuation or a comma. `m` flag makes `^` match line starts.
  const openers = compilePlainWordlist(openersSrc, {
    prefix: "^\\s*",
    suffix: "(?=[.!,])",
    flags: "gm",
  });
  if (!openers) throw new Error("openers.txt produced no entries");

  // let-me-verbs compiles into a single regex: \b(?:now\s+)?let\s+me\s+(?:...)
  const letMeVerbs = compilePlainWordlist(letMeVerbsSrc, {
    prefix: "\\b(?:now\\s+)?let\\s+me\\s+(?:",
    suffix: ")\\b",
    flags: "gi",
  });
  if (!letMeVerbs) throw new Error("let-me-verbs.txt produced no entries");

  const marketingVerbs = compileWeightedWordlist(marketingSrc);

  return { vocabulary, openers, letMeVerbs, marketingVerbs };
}

// Top-level await: the hook process is short-lived and loads each wordlist
// once. Keeping `scan` synchronous avoids cascading async through callers.
export const WORDLISTS: LoadedWordlists = await load();
