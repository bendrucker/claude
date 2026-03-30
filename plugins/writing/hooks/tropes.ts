export type PatternTier = "deny" | "context";

export type PatternMatch = {
  tier: PatternTier;
  category: string;
  matched: string;
  message: string;
};

type PatternDef = {
  tier: PatternTier;
  category: string;
  test: RegExp | ((text: string) => boolean);
  message: (matched: string) => string;
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

function hasTestResultReport(text: string): boolean {
  for (const sentence of text.split(/[.!?\n]+/)) {
    const s = sentence.trim();
    for (const pattern of RESULT_SENTENCES) {
      pattern.lastIndex = 0;
      const match = pattern.exec(s);
      if (!match) continue;
      const after = s.slice(match.index + match[0].length).trim();
      if (DETERMINERS.test(after)) continue;
      return true;
    }
  }
  return false;
}

const PATTERNS: PatternDef[] = [
  {
    tier: "deny",
    category: "spaced em dash",
    test: / \u2014 /g,
    message: () =>
      "Spaced em dashes ( \u2014 ) are an AI writing tell. Use unspaced em dashes (\u2014), commas, colons, or parentheses instead.",
  },
  {
    tier: "deny",
    category: "AI vocabulary",
    test: /\b(delve|tapestry|landscape|meticulous(?:ly)?|pivotal|testament|underscore[sd]?|interplay|intricacies|bolstered|garner(?:ed|s)?|foster(?:ing|ed|s)?)\b/gi,
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
    tier: "context",
    category: "test result reporting",
    test: hasTestResultReport,
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
    category: "parallelism",
    test: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi,
    message: () =>
      '"Not just X, but also Y" is a common AI parallelism pattern. Simplify the sentence.',
  },
  {
    tier: "context",
    category: "semicolon overuse",
    test: /;[^;]*;[^;]*;/g,
    message: () =>
      "Multiple semicolons in close proximity. AI tends to overuse semicolons. Prefer shorter sentences or commas.",
  },
];

export function stripCode(text: string): string {
  return text.replace(FENCED_CODE_BLOCK, "").replace(INLINE_CODE, "");
}

export function scan(text: string): PatternMatch[] {
  const stripped = stripCode(text);
  const matches: PatternMatch[] = [];
  const seenTiers = new Set<PatternTier>();

  for (const def of PATTERNS) {
    if (seenTiers.has(def.tier)) continue;

    let matched: string | null = null;
    if (typeof def.test === "function") {
      if (def.test(stripped)) matched = "";
    } else {
      def.test.lastIndex = 0;
      const result = def.test.exec(stripped);
      if (result) matched = result[0];
    }

    if (matched !== null) {
      matches.push({
        tier: def.tier,
        category: def.category,
        matched,
        message: def.message(matched),
      });
      seenTiers.add(def.tier);
    }
  }

  return matches;
}

export function firstByTier(matches: PatternMatch[], tier: PatternTier): PatternMatch | undefined {
  return matches.find((m) => m.tier === tier);
}
