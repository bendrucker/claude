export const TAGS = ["simplify", "measure", "skeptic", "decision", "other"] as const;
export type Tag = (typeof TAGS)[number];

const THEMES: readonly (readonly [Exclude<Tag, "other">, RegExp])[] = [
  ["simplify", /\b(simpl\w*|upstream|overkill|existing)\b/i],
  ["measure", /\b(tests?|evals?|verif\w*|measur\w*|benchmark\w*)\b/i],
  ["skeptic", /\b(critique|push back|poke holes|skeptic\w*)\b/i],
  ["decision", /\b(why|alternatives?|decid\w*|choice)\b/i],
];

export function tagRedirect(text: string): Tag {
  return THEMES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

export const MIN_REDIRECT_CHARS = 40;

// Scope and sequencing instructions no plan could anticipate.
const UNANTICIPATABLE: readonly RegExp[] = [
  /\bfile (it|this|that) under\b/i,
  /\bunder the parent\b/i,
  /\bstack(ed)? (it |this )?on\b/i,
  /\babout to (land|merge)\b/i,
  /\bafter .{0,40}\b(lands|merges|is merged)\b/i,
  /\brebase (it |this )?(on|onto)\b/i,
  /\b(new|separate) (branch|worktree|pr)\b/i,
];

export function isExcluded(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < MIN_REDIRECT_CHARS || UNANTICIPATABLE.some((p) => p.test(trimmed));
}

const REJECTION_MARKER = /the user said:\s*/i;

/** The feedback a rejected `ExitPlanMode` result carries, or null for a silent rejection. */
export function feedbackFrom(result: string | null): string | null {
  if (result === null) return null;
  const match = REJECTION_MARKER.exec(result);
  if (match === null) return null;
  const feedback = result.slice(match.index + match[0].length).trim();
  return feedback === "" ? null : feedback;
}
