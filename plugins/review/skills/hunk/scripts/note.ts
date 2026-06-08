export type NoteSource = "user" | "agent" | "ai";
export type AnchorSide = "new" | "old";

export interface HunkNote {
  noteId: string;
  source?: NoteSource;
  filePath: string;
  hunkIndex?: number;
  newRange: [number, number] | null;
  oldRange: [number, number] | null;
  body: string;
  createdAt?: string;
}

export interface Anchor {
  side: AnchorSide;
  line: number;
  path: string;
}

/**
 * Resolve a note's anchor: the new-side line when `newRange` is present
 * (side = new/RIGHT), otherwise the old-side line (side = old/LEFT).
 */
export function deriveAnchor(note: HunkNote): Anchor {
  if (note.newRange) {
    return { side: "new", line: note.newRange[0], path: note.filePath };
  }
  if (note.oldRange) {
    return { side: "old", line: note.oldRange[0], path: note.filePath };
  }
  throw new Error("note has no anchor");
}

/** Decode a notes JSON payload, accepting either `{ comments: [...] }` or a bare array. */
export function decodeNotes(raw: string): HunkNote[] {
  const data = JSON.parse(raw) as { comments: HunkNote[] } | HunkNote[];
  return Array.isArray(data) ? data : data.comments;
}
