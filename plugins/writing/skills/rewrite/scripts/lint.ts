#!/usr/bin/env bun
import { stemmer } from "stemmer";
import { WORDLISTS, weightedStemHits } from "../../../hooks/wordlists";

const WORD_TOKEN = /[a-zA-Z]+/g;

type Violation = {
  line: number;
  col: number;
  category: string;
  matched: string;
  message: string;
};

type InlinePattern = {
  category: string;
  pattern: RegExp;
  message: (matched: string) => string;
};

const INLINE_PATTERNS: InlinePattern[] = [
  {
    category: "spaced em dash",
    pattern: / — /g,
    message: () => "Use commas, colons, or parentheses instead of spaced em dashes.",
  },
  {
    category: "copula avoidance",
    pattern: /\b(?:serves|stands) as\b/gi,
    message: (m) => `Replace "${m}" with "is" or "are".`,
  },
  {
    category: "reaching for",
    pattern: /\breach(?:ing|es|ed)?\s+for\b/gi,
    message: () => `Use "use" or "prefer X over Y" instead.`,
  },
  {
    category: "parallelism",
    pattern: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi,
    message: () => "State both things directly.",
  },
  {
    category: "hedging",
    pattern: /\b(?:looks|appears|seems)\s+(?:like|to)\b/gi,
    message: (m) => `"${m}" hedges. State directly or name the uncertainty.`,
  },
  {
    category: "dig into",
    pattern: /\b(?:dig|dive|wade)\s+into\b/gi,
    message: () => "Describe what you're looking at.",
  },
  {
    category: "promotional",
    pattern: /\b(boasts|vibrant|showcasing|nestled|groundbreaking|renowned|diverse array)\b/gi,
    message: (m) => `"${m}" is promotional. Use a neutral alternative.`,
  },
  {
    category: "trailing hedge",
    pattern: /\b(?:regardless|nonetheless|anyway)\.\s*$/gim,
    message: (m) => `"${m.trim()}" dangles. Drop it or rewrite.`,
  },
  {
    category: "filler",
    pattern:
      /\b(?:it's worth noting that|importantly|interestingly|it should be noted|as mentioned|in terms of)\b/gi,
    message: (m) => `"${m}" is filler. Cut it.`,
  },
];

function lintLine(line: string, lineNum: number, stripped: string): Violation[] {
  const violations: Violation[] = [];

  for (const { category, pattern, message } of INLINE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      violations.push({
        line: lineNum,
        col: match.index + 1,
        category,
        matched: match[0],
        message: message(match[0]),
      });
    }
  }

  return violations;
}

async function lintVocabulary(lines: string[], strippedLines: string[]): Promise<Violation[]> {
  const violations: Violation[] = [];
  const vocabStems = new Set<string>();
  const vocabFile = Bun.file(
    `${import.meta.dirname}/../../../wordlists/vocabulary.txt`,
  );

  const content = await vocabFile.text();
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    for (const word of trimmed.toLowerCase().match(WORD_TOKEN) ?? []) {
      vocabStems.add(stemmer(word));
    }
  }

  for (let i = 0; i < strippedLines.length; i++) {
    const words = strippedLines[i].match(WORD_TOKEN) ?? [];
    let col = 0;
    for (const word of words) {
      const idx = strippedLines[i].indexOf(word, col);
      if (vocabStems.has(stemmer(word.toLowerCase()))) {
        violations.push({
          line: i + 1,
          col: idx + 1,
          category: "vocabulary",
          matched: word,
          message: `"${word}" is AI-typical vocabulary. Use a natural alternative.`,
        });
      }
      col = idx + word.length;
    }
  }

  return violations;
}

function lintMarketingVerbs(strippedLines: string[]): Violation[] {
  const violations: Violation[] = [];

  for (let i = 0; i < strippedLines.length; i++) {
    const words = strippedLines[i].match(WORD_TOKEN) ?? [];
    let col = 0;
    for (const word of words) {
      const idx = strippedLines[i].indexOf(word, col);
      const stem = stemmer(word.toLowerCase());
      const entry = WORDLISTS.marketingVerbs.find((e) => e.stem === stem);
      if (entry) {
        violations.push({
          line: i + 1,
          col: idx + 1,
          category: "marketing verb",
          matched: word,
          message: `"${word}" is a marketing verb (weight ${entry.weight}). Use a concrete alternative.`,
        });
      }
      col = idx + word.length;
    }
  }

  return violations;
}

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

function stripCode(text: string): string {
  return text
    .replace(FENCED_CODE, (m) => "\n".repeat(m.split("\n").length - 1))
    .replace(INLINE_CODE, (m) => " ".repeat(m.length));
}

async function main(): Promise<void> {
  let input: string;
  const arg = process.argv[2];

  if (arg && (await Bun.file(arg).exists())) {
    input = await Bun.file(arg).text();
  } else if (arg) {
    input = arg;
  } else {
    input = await new Response(Bun.stdin.stream()).text();
  }

  const stripped = stripCode(input);
  const lines = input.split("\n");
  const strippedLines = stripped.split("\n");

  const violations: Violation[] = [];

  for (let i = 0; i < strippedLines.length; i++) {
    violations.push(...lintLine(lines[i], i + 1, strippedLines[i]));
  }

  violations.push(...(await lintVocabulary(lines, strippedLines)));
  violations.push(...lintMarketingVerbs(strippedLines));

  violations.sort((a, b) => a.line - b.line || a.col - b.col);

  if (violations.length === 0) {
    console.log("No violations found.");
    process.exit(0);
  }

  for (const v of violations) {
    console.log(`${v.line}:${v.col}: ${v.category}: ${v.message}`);
  }

  process.exit(1);
}

await main();
