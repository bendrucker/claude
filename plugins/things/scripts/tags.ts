export function parseTags(value: string | undefined): string[] {
  if (value == null || value === "") return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function mergeTags(...sources: string[][]): string[] {
  return [...new Set(sources.flat())];
}

export interface TagResolution {
  /** Requested tags remapped to the casing Things stores, deduped. */
  resolved: string[];
  /** Requested tags with no case-insensitive match in Things. */
  unknown: string[];
}

/**
 * Matches requested tags against the tags Things already holds.
 *
 * Things refuses to apply a tag it does not know and reports success anyway, so
 * a caller only learns a tag was dropped by reading the todo back. Resolving
 * first turns that silence into either the stored name or a named miss.
 *
 * Matching folds case because Things does: asking for `CLAUDE` when `claude`
 * exists names the same tag, and emitting both would send it twice.
 */
export function resolveTags(requested: string[], existing: string[]): TagResolution {
  const byFolded = new Map<string, string>();
  for (const tag of existing) {
    const folded = tag.toLowerCase();
    if (!byFolded.has(folded)) byFolded.set(folded, tag);
  }

  const resolved: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const tag of requested) {
    const folded = tag.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);

    const match = byFolded.get(folded);
    if (match === undefined) unknown.push(tag);
    else resolved.push(match);
  }

  return { resolved, unknown };
}
