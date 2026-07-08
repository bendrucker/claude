// Single-letter model indicator for the status lines. The family token in the
// model id is authoritative. display_name is the fallback for ids whose family
// we don't recognize, so a future model still gets a letter.

const FAMILY_LETTERS: Record<string, string> = {
  opus: "O",
  sonnet: "S",
  haiku: "H",
  fable: "F",
};

export function modelLetter(id?: string | null, displayName?: string | null): string | null {
  const hay = (id ?? "").toLowerCase();
  for (const [family, letter] of Object.entries(FAMILY_LETTERS)) {
    if (hay.includes(family)) return letter;
  }
  const fallback = (displayName ?? "").match(/[a-z]/i);
  return fallback ? fallback[0].toUpperCase() : null;
}
