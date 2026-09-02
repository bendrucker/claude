// Model family resolution shared by the status lines and the agent-model hook.
// The family token in the model id is authoritative. display_name is the
// fallback for ids whose family we don't recognize, so a future model still
// gets a letter.

export const MODEL_FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

const FAMILY_LETTERS: Record<ModelFamily, string> = {
  opus: "o",
  sonnet: "s",
  haiku: "h",
  fable: "f",
};

// The un-highlighted family. Any other model renders in the accent color so a
// non-default model stands out.
const DEFAULT_FAMILY: ModelFamily = "opus";

export interface ModelMarker {
  letter: string;
  isDefault: boolean;
}

export function modelFamily(id?: string | null): ModelFamily | null {
  const hay = (id ?? "").toLowerCase();
  return MODEL_FAMILIES.find((family) => hay.includes(family)) ?? null;
}

export function modelMarker(id?: string | null, displayName?: string | null): ModelMarker | null {
  const family = modelFamily(id);
  if (family !== null)
    return { letter: FAMILY_LETTERS[family], isDefault: family === DEFAULT_FAMILY };

  const fallback = (displayName ?? "").match(/[a-z]/i);
  return fallback ? { letter: fallback[0].toLowerCase(), isDefault: false } : null;
}
