// Frustration lexicon: terms that, in a short human-authored message, signal
// the user pushing back on writing quality. Multi-word entries are matched as
// phrases. Used to surface labeled-slop moments where the user named a problem
// in the model's prose, which are higher-signal than inferred corrections.
export const FRUSTRATION_TERMS = [
  "wtf",
  "ugh",
  "gross",
  "stop",
  "cut the",
  "tighten",
  "jargon",
  "marketing",
  "fluff",
  "buzzword",
  "flowery",
  "verbose",
  "wordy",
  "dramatic",
  "clanker",
  "reads like",
];

// Terms that only count when a writing-complaint word from FRUSTRATION_TERMS
// also appears in the same message. "sounds like" is common in non-writing
// contexts ("sounds like a plan"), so require co-occurrence to filter noise.
export const GATED_TERMS = ["sounds like"];

export function escapeRegex(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

// A DuckDB-compatible regex alternation with word boundaries. DuckDB's regexp
// engine (RE2) supports \b, so short terms like "stop" do not match inside
// "stopped" is acceptable here (we want the standalone gripe), and "ugh" will
// not fire on "tough".
export function frustrationRegex(terms: string[] = FRUSTRATION_TERMS): string {
  const fragments = terms.map(escapeRegex).join("|");
  return `\\b(?:${fragments})\\b`;
}

// Regex matching gated terms that require co-occurrence with a primary term.
export function gatedRegex(terms: string[] = GATED_TERMS): string {
  const fragments = terms.map(escapeRegex).join("|");
  return `\\b(?:${fragments})\\b`;
}
