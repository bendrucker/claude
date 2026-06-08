import { isProseFile } from "./markdown";
import {
  type Hits,
  type StemmedWeight,
  stemmedPhraseHits,
  WORDLISTS,
  weightedStemHits,
} from "./wordlists";

export type PatternTier = "deny" | "context";

export type ScanContext = "file" | "sideEffect";

export type PatternMatch = {
  tier: PatternTier;
  category: string;
  matched: string;
  message: string;
  structural: boolean;
};

export type PatternDef = {
  tier: PatternTier;
  category: string;
  test: RegExp | ((text: string) => Hits);
  message: (matched: string) => string;
  fileOnly?: boolean;
  sideEffectOnly?: boolean;
  structural?: boolean;
};

export type WeightedPatternGroup = {
  tier: PatternTier;
  category: string;
  entries: StemmedWeight[];
  threshold: number;
  message: (matchedExamples: string[], totalWeight: number) => string;
  fileOnly?: boolean;
};

const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

const DETERMINERS = /^(?:the|a|an|it|them|this|that|its)\b/i;

const RESULT_SENTENCES = [
  /\b(?:all\s+)?\d+(?:\/\d+)?\s+(?:\w+\s+)*(?:pass|fail|succeed)/i,
  /\b(?:all|every|both)\s+(?:\w+\s+)*(?:pass(?:es|ed|ing)?|green)/i,
  /\b(?:0|zero)\s+(?:errors?|failures?|warnings?)\b/i,
  /\b\S+\s+(?:(?:is|are)\s+)?(?:now\s+)?(?:green|clean)\b/i,
  /\bonce\s+\S+\s+pass/i,
  /^(?:\w+\s+){0,3}pass(?:es|ed|ing)?(?:\s|$)/im,
];

function testResultHits(text: string): Hits {
  for (const sentence of text.split(/[.!?\n]+/)) {
    const s = sentence.trim();
    for (const pattern of RESULT_SENTENCES) {
      pattern.lastIndex = 0;
      const match = pattern.exec(s);
      if (!match) continue;
      const after = s.slice(match.index + match[0].length).trim();
      if (DETERMINERS.test(after)) continue;
      return { count: 1, sample: match[0] };
    }
  }
  return { count: 0, sample: "" };
}

const CROSS_SENTENCE_NOT =
  /\b(it|this|that|he|she|they|we|you)\s+(?:is|are|was|were)(?:n't|\s+not)\s+[^.!?]{1,80}[.!?]\s+\1\s+(?:is|are|was|were)\b/gi;

const CLAUSE_CONNECTOR = /;|—|[A-Za-z] [-–] [A-Za-z]/;
const HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;
const MIN_SENTENCES = 5;
const MIN_CONNECTOR_SENTENCES = 3;
const CONNECTOR_DENSITY = 0.3;

// In a list item a dash usually separates a label from its gloss (`- **term** — gloss`)
// rather than joining two clauses, so only a semicolon counts as a connector there.
function isConnectorSentence(sentence: string): boolean {
  if (LIST_ITEM.test(sentence)) return sentence.includes(";");
  return CLAUSE_CONNECTOR.test(sentence);
}

function connectorDensityHits(text: string): Hits {
  const sentences = text
    .split(/(?<!\d)[.!?]+(?=\s|$)|\n+/)
    .map((s) => s.trim())
    .filter((s) => !s.startsWith("|"))
    .filter((s) => !HEADING.test(s))
    .filter((s) => s.split(/\s+/).length >= 4);
  if (sentences.length < MIN_SENTENCES) return { count: 0, sample: "" };
  const connected = sentences.filter(isConnectorSentence);
  if (connected.length < MIN_CONNECTOR_SENTENCES) return { count: 0, sample: "" };
  if (connected.length / sentences.length < CONNECTOR_DENSITY) return { count: 0, sample: "" };
  const first = connected[0] as string;
  const i = CLAUSE_CONNECTOR.exec(first)?.index ?? 0;
  return { count: connected.length, sample: first.slice(Math.max(0, i - 20), i + 24).trim() };
}

export const PATTERNS: PatternDef[] = [
  {
    tier: "deny",
    category: "spaced em dash",
    structural: true,
    test: / — /g,
    message: () =>
      "Spaced em dashes ( — ) are an AI writing tell. Split the clauses into two sentences. Do not substitute a semicolon or unspaced em dash: the run-on structure is the problem, not the mark.",
  },
  {
    tier: "deny",
    category: "AI vocabulary",
    test: WORDLISTS.vocabulary,
    message: (matched) =>
      `"${matched}" is flagged as AI-typical vocabulary. Use a more natural word.`,
  },
  {
    tier: "deny",
    category: "copula avoidance",
    test: /\b(?:serves|stands) as\b/gi,
    message: (matched) => `"${matched}" avoids a simple copula. Use "is" or "are" instead.`,
  },
  {
    tier: "deny",
    category: "sycophantic opener",
    test: WORDLISTS.openers,
    sideEffectOnly: true,
    message: (matched) =>
      `"${matched.trim()}" reads as a sycophantic opener. Open with the substance.`,
  },
  {
    tier: "deny",
    category: "sycophantic acknowledgment",
    test: /\byou(?:'re|\s+are)\s+(?:absolutely\s+|completely\s+)?right\b/gi,
    sideEffectOnly: true,
    message: () =>
      '"You\'re right" is a sycophantic acknowledgment. Move directly to the correction.',
  },
  {
    tier: "deny",
    category: "permission-seeking",
    test: /\bwant\s+me\s+to\s+\w+/gi,
    sideEffectOnly: true,
    message: () => '"Want me to ..." reads as permission-seeking. Just do it, or describe options.',
  },
  {
    tier: "deny",
    category: "hedging close",
    test: /\bwould\s+you\s+like\b/gi,
    sideEffectOnly: true,
    message: () => '"Would you like ..." is a hedging close. State the next step directly.',
  },
  {
    tier: "deny",
    category: "reaching for",
    test: /\breach(?:ing|es|ed)?\s+for\b/gi,
    message: (matched) =>
      `"${matched}" is an AI-flavored figurative construction. Prefer "use" or "prefer X over Y".`,
  },
  {
    tier: "context",
    category: "connector density",
    test: connectorDensityHits,
    fileOnly: true,
    message: (matched) =>
      `Many sentences here fuse independent clauses with semicolons or dashes (e.g. "${matched}"). This is run-on structure. Split each into two sentences. Swapping one connector for another is not a fix.`,
  },
  {
    tier: "context",
    category: "test result reporting",
    test: testResultHits,
    message: () =>
      "Do not report test results, counts, or CI status. Describe what is covered instead.",
  },
  {
    tier: "context",
    category: "promotional language",
    test: /\b(boasts|vibrant|showcasing|nestled|groundbreaking|renowned|diverse array)\b/gi,
    message: (matched) =>
      `"${matched}" reads as promotional AI language. Consider a more neutral word.`,
  },
  {
    tier: "context",
    category: "flowery phrasing",
    test: (text) => stemmedPhraseHits(text, WORDLISTS.floweryPhrases),
    fileOnly: true,
    message: (matched) =>
      `"${matched}" is stock phrasing the model reaches for. State the mechanism plainly.`,
  },
  {
    tier: "context",
    category: "parallelism",
    test: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi,
    message: () =>
      '"Not just X, but also Y" is a common AI parallelism pattern. Simplify the sentence.',
  },
  {
    tier: "context",
    category: "cross-sentence not-X",
    test: CROSS_SENTENCE_NOT,
    message: () =>
      'Cross-sentence "It isn\'t X. It is Y." patterns are an AI tell. Combine into one sentence or drop the negation.',
  },
  {
    tier: "context",
    category: "passive PR summary",
    test: /\b(?:is|was|are|were)\s+(?:added|updated|removed|refactored|introduced|created|deleted|modified|improved)\b/gi,
    fileOnly: true,
    message: (matched) =>
      `"${matched}" is passive voice in PR-style writing. Rewrite so something is doing the verb.`,
  },
  {
    tier: "context",
    category: "tests cover preamble",
    test: /^Tests\s+(?:cover|verify|ensure|validate)\b/m,
    message: () =>
      '"Tests cover ..." elides the subject. Use "Added tests covering ..." or describe the change.',
  },
  {
    tier: "context",
    category: "path bullet",
    test: /^\s*-\s*\*\*[^*\n]+\*\*\s*:\s*/m,
    fileOnly: true,
    message: () =>
      "`- **path**: description` bullets read as file manifests. Describe the conceptual change in prose.",
  },
  {
    tier: "context",
    category: "trailing hedge",
    test: /\b(?:regardless|nonetheless|anyway)\.\s*(?:$|\n)/gim,
    fileOnly: true,
    message: (matched) =>
      `"${matched.trim()}" dangles at sentence end as AI hedging. Drop it or rewrite the clause.`,
  },
  {
    tier: "context",
    category: "label bold",
    test: /^\s*\*\*[A-Z][A-Za-z ]+(?::\*\*|\*\*:)\s/m,
    fileOnly: true,
    message: () => "`**Label:**` reads as templated. Use a `####` header instead.",
  },
  {
    tier: "context",
    category: "dig into",
    test: /\b(?:dig|dive|wade)\s+into\b/gi,
    message: (matched) =>
      `"${matched}" is exploration filler. Describe what you're actually looking at.`,
  },
  {
    tier: "context",
    category: "hedging observation",
    test: /\b(?:looks|appears|seems)\s+(?:like|to)\b/gi,
    message: (matched) =>
      `"${matched}" is hedging observation. State the observation directly or name the uncertainty.`,
  },
  {
    tier: "context",
    category: "filler",
    test: /\b(?:it's worth noting that|importantly|interestingly|it should be noted|as mentioned|in terms of)\b/gi,
    message: (matched) => `"${matched}" is filler. Cut it.`,
  },
  {
    tier: "context",
    category: "I understand",
    test: /\bi\s+understand\b/gi,
    sideEffectOnly: true,
    message: () => '"I understand" is a sycophantic preamble. Move to the substance.',
  },
];

const MARKETING_VERB_THRESHOLD = 3.0;
const SOFT_PHRASING_THRESHOLD = 3.0;

export const WEIGHTED_PATTERNS: WeightedPatternGroup[] = [
  {
    tier: "context",
    category: "marketing verbs",
    entries: WORDLISTS.marketingVerbs,
    threshold: MARKETING_VERB_THRESHOLD,
    message: (examples) =>
      `Marketing verbs stack up (${examples.join(", ")}). Describe concretely what changed instead of promotional framing.`,
  },
  {
    tier: "context",
    category: "soft phrasing",
    entries: WORDLISTS.softPhrasing,
    threshold: SOFT_PHRASING_THRESHOLD,
    fileOnly: true,
    message: (examples) =>
      `Soft phrasing piles up (${examples.join(", ")}). These read as filler. Describe what the code does plainly.`,
  },
];

function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === "\n") count++;
  }
  return count;
}

// Replace code with whitespace that preserves both line and column offsets, so a
// match index in the stripped text maps back to the same position in the source.
export function stripCode(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK, (block) => "\n".repeat(countNewlines(block)))
    .replace(INLINE_CODE, (code) => " ".repeat(code.length));
}

function patternHits(stripped: string, def: PatternDef): Hits {
  if (typeof def.test === "function") {
    return def.test(stripped);
  }
  def.test.lastIndex = 0;
  const all = stripped.match(def.test);
  return { count: all?.length ?? 0, sample: all?.[0] ?? "" };
}

export function scan(text: string, filePath?: string, context?: ScanContext): PatternMatch[] {
  return scanIntroduced(text, "", filePath, context);
}

export function scanIntroduced(
  newText: string,
  oldText: string,
  filePath?: string,
  context?: ScanContext,
): PatternMatch[] {
  const newStripped = stripCode(newText);
  const oldStripped = stripCode(oldText);
  const matches: PatternMatch[] = [];
  const seenTiers = new Set<PatternTier>();

  for (const def of PATTERNS) {
    if (seenTiers.has(def.tier)) continue;
    if (def.fileOnly && filePath && !isProseFile(filePath)) continue;
    if (def.sideEffectOnly && context === "file") continue;

    const newHits = patternHits(newStripped, def);
    if (newHits.count === 0) continue;
    const oldHits = patternHits(oldStripped, def);
    if (newHits.count <= oldHits.count) continue;

    matches.push({
      tier: def.tier,
      category: def.category,
      matched: newHits.sample,
      message: def.message(newHits.sample),
      structural: def.structural ?? false,
    });
    seenTiers.add(def.tier);
  }

  for (const group of WEIGHTED_PATTERNS) {
    if (seenTiers.has(group.tier)) continue;
    if (group.fileOnly && filePath && !isProseFile(filePath)) continue;

    const newWeighted = weightedStemHits(newStripped, group.entries);
    if (newWeighted.totalWeight < group.threshold) continue;
    const oldWeighted = weightedStemHits(oldStripped, group.entries);
    if (newWeighted.totalWeight <= oldWeighted.totalWeight) continue;

    matches.push({
      tier: group.tier,
      category: group.category,
      matched: newWeighted.samples[0] ?? "",
      message: group.message(newWeighted.samples, newWeighted.totalWeight),
      structural: false,
    });
    seenTiers.add(group.tier);
  }

  return matches;
}

export function firstByTier(matches: PatternMatch[], tier: PatternTier): PatternMatch | undefined {
  return matches.find((m) => m.tier === tier);
}
