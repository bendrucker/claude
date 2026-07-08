// Braille dot-ramp for the reasoning effort level, low to max. More dots is more
// effort. Null when the level is unknown or the model reports no effort, so the
// segment simply drops rather than rendering a placeholder.
const EFFORT_GLYPHS: Record<string, string> = {
  low: "⠂",
  medium: "⠆",
  high: "⠇",
  xhigh: "⠧",
  max: "⠿",
};

export function effortGlyph(level?: string | null): string | null {
  if (!level) return null;
  return EFFORT_GLYPHS[level] ?? null;
}
