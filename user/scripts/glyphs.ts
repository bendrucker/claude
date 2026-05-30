// Nerd-font codepoints rendered as glyphs. App constants, not a library.

// Eight-step context dial ramp; idx 0-7 selects the fill level.
const DIAL_BASE = 0xf0a9e;

export function dialGlyph(idx: number): string {
  return String.fromCodePoint(DIAL_BASE + idx);
}

// Purpose glyphs mark the agent kind. Untyped kinds get no glyph.
export const purposeGlyphs = new Map<string, string>([
  ["Explore", String.fromCodePoint(0xf002)],
  ["Plan", String.fromCodePoint(0xf0ea)],
  ["claude-code-guide", String.fromCodePoint(0xf02d)],
]);

// Cloud marker for remote agents.
export const remoteGlyph = String.fromCodePoint(0xf0c2);
