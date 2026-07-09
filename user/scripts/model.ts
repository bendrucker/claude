// Single-letter model indicator for the status lines. The family token in the
// model id is authoritative. display_name is the fallback for ids whose family
// we don't recognize, so a future model still gets a letter.

const FAMILY_LETTERS: Record<string, string> = {
  opus: "o",
  sonnet: "s",
  haiku: "h",
  fable: "f",
};

// The un-highlighted family. Any other model renders in the accent color so a
// non-default model stands out.
const DEFAULT_FAMILY = "opus";

export interface ModelMarker {
  letter: string;
  isDefault: boolean;
}

export function modelMarker(id?: string | null, displayName?: string | null): ModelMarker | null {
  const hay = (id ?? "").toLowerCase();
  for (const [family, letter] of Object.entries(FAMILY_LETTERS)) {
    if (hay.includes(family)) return { letter, isDefault: family === DEFAULT_FAMILY };
  }
  const fallback = (displayName ?? "").match(/[a-z]/i);
  return fallback ? { letter: fallback[0].toLowerCase(), isDefault: false } : null;
}
