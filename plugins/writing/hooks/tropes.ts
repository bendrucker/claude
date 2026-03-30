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
  pattern: RegExp;
  message: (matched: string) => string;
};

const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

const PATTERNS: PatternDef[] = [
  {
    tier: "deny",
    category: "spaced em dash",
    pattern: / \u2014 /g,
    message: () =>
      "Spaced em dashes ( \u2014 ) are an AI writing tell. Use unspaced em dashes (\u2014), commas, colons, or parentheses instead.",
  },
  {
    tier: "deny",
    category: "AI vocabulary",
    pattern:
      /\b(delve|tapestry|landscape|meticulous(?:ly)?|pivotal|testament|underscore[sd]?|interplay|intricacies|bolstered|garner(?:ed|s)?|foster(?:ing|ed|s)?)\b/gi,
    message: (matched) =>
      `"${matched}" is flagged as AI-typical vocabulary. Use a more natural word.`,
  },
  {
    tier: "deny",
    category: "copula avoidance",
    pattern: /\b(?:serves|stands) as\b/gi,
    message: (matched) => `"${matched}" avoids a simple copula. Use "is" or "are" instead.`,
  },
  {
    tier: "context",
    category: "promotional language",
    pattern: /\b(boasts|vibrant|showcasing|nestled|groundbreaking|renowned|diverse array)\b/gi,
    message: (matched) =>
      `"${matched}" reads as promotional AI language. Consider a more neutral word.`,
  },
  {
    tier: "context",
    category: "parallelism",
    pattern: /\bnot (?:just|only) .{1,50}, but (?:also )?/gi,
    message: () =>
      '"Not just X, but also Y" is a common AI parallelism pattern. Simplify the sentence.',
  },
  {
    tier: "context",
    category: "semicolon overuse",
    pattern: /;[^;]*;[^;]*;/g,
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

    def.pattern.lastIndex = 0;
    const match = def.pattern.exec(stripped);
    if (match) {
      matches.push({
        tier: def.tier,
        category: def.category,
        matched: match[0],
        message: def.message(match[0]),
      });
      seenTiers.add(def.tier);
    }
  }

  return matches;
}

export function firstByTier(matches: PatternMatch[], tier: PatternTier): PatternMatch | undefined {
  return matches.find((m) => m.tier === tier);
}
