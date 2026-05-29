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
  "sounds like",
];

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A DuckDB-compatible regex alternation with word boundaries. DuckDB's regexp
// engine (RE2) supports \b, so short terms like "stop" do not match inside
// "stopped" is acceptable here (we want the standalone gripe), and "ugh" will
// not fire on "tough".
export function frustrationRegex(terms: string[] = FRUSTRATION_TERMS): string {
  const fragments = terms.map(escapeRegex).join("|");
  return `\\b(?:${fragments})\\b`;
}
