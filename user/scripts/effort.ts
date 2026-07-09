// Baseline vertical-dot ramp for the reasoning effort level, low to max. Dot
// count grows with effort, and the dots sit on the text baseline so the glyph
// aligns with the model letter rather than floating like braille.
const EFFORT_GLYPHS: Record<string, string> = {
  low: "∙",
  medium: "⁚",
  high: "⁝",
  xhigh: "⁞",
  max: "⁙",
};

// The un-highlighted level. Effort at any other level renders in the accent
// color so an off-default session config stands out.
const DEFAULT_EFFORT = "high";

export interface EffortMarker {
  glyph: string;
  isDefault: boolean;
}

// Null when the level is unknown or the model reports no effort, so the segment
// simply drops rather than rendering a placeholder.
export function effortMarker(level?: string | null): EffortMarker | null {
  if (!level) return null;
  const glyph = EFFORT_GLYPHS[level];
  if (!glyph) return null;
  return { glyph, isDefault: level === DEFAULT_EFFORT };
}
