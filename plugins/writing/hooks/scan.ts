import { isProseFile } from "./markdown";
import {
  type PatternDef,
  PATTERNS,
  stripCode,
  type WeightedPatternGroup,
  WEIGHTED_PATTERNS,
} from "./tropes";
import { weightedStemHits } from "./wordlists";

export type ScanResult = {
  line: number;
  col: number;
  category: string;
  matched: string;
  message: string;
};

type Position = { line: number; col: number };

function positionAt(text: string, index: number): Position {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: index - lastNewline };
}

// Best-effort position for a sample string the matcher reported without an index.
function positionOfSample(text: string, sample: string): Position {
  if (sample) {
    const index = text.toLowerCase().indexOf(sample.toLowerCase());
    if (index >= 0) return positionAt(text, index);
  }
  return { line: 1, col: 1 };
}

function regexResults(stripped: string, def: PatternDef): ScanResult[] {
  if (typeof def.test === "function") {
    const hits = def.test(stripped);
    if (hits.count === 0) return [];
    const { line, col } = positionOfSample(stripped, hits.sample);
    return [
      {
        line,
        col,
        category: def.category,
        matched: hits.sample,
        message: def.message(hits.sample),
      },
    ];
  }

  const results: ScanResult[] = [];
  const pattern = def.test;
  const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  global.lastIndex = 0;
  for (let match = global.exec(stripped); match !== null; match = global.exec(stripped)) {
    const { line, col } = positionAt(stripped, match.index);
    results.push({
      line,
      col,
      category: def.category,
      matched: match[0],
      message: def.message(match[0]),
    });
    if (match[0].length === 0) global.lastIndex++;
  }
  return results;
}

function weightedResults(stripped: string, group: WeightedPatternGroup): ScanResult[] {
  const hits = weightedStemHits(stripped, group.entries);
  if (hits.totalWeight < group.threshold) return [];
  const { line, col } = positionOfSample(stripped, hits.samples[0] ?? "");
  return [
    {
      line,
      col,
      category: group.category,
      matched: hits.samples[0] ?? "",
      message: group.message(hits.samples, hits.totalWeight),
    },
  ];
}

// Report every trope match in `text`, without per-tier dedup or diff-awareness.
// Patterns run in `file` context: `fileOnly` patterns apply, `sideEffectOnly` do not.
export function scanAll(text: string, filePath?: string): ScanResult[] {
  const stripped = stripCode(text);
  const prose = filePath === undefined || isProseFile(filePath);
  const results: ScanResult[] = [];

  for (const def of PATTERNS) {
    if (def.sideEffectOnly) continue;
    if (def.fileOnly && !prose) continue;
    results.push(...regexResults(stripped, def));
  }

  for (const group of WEIGHTED_PATTERNS) {
    if (group.fileOnly && !prose) continue;
    results.push(...weightedResults(stripped, group));
  }

  results.sort((a, b) => a.line - b.line || a.col - b.col);
  return results;
}
