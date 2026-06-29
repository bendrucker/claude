import { lineStartOffsets, sliceRange } from "../detection/offsets";
import type { Manifest, ManifestEntry } from "../judge/job";
import { parseVerdict } from "../judge/judge";
import type { Verdict } from "../judge/schema";

export interface JoinedItem {
  id: string;
  entry: ManifestEntry;
  verdict: Verdict;
}

/**
 * Fold the verdict shards the agents wrote into one id→verdict map, validating
 * each verdict's shape and rejecting a duplicate id. Mirrors the rigor of the
 * oracle's batch parse, so a malformed agent verdict is a hard error here rather
 * than silently corrupting a file at apply time.
 */
export function collectVerdicts(shards: unknown[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const shard of shards) {
    if (typeof shard !== "object" || shard === null) {
      throw new Error("Verdict shard must be a JSON object");
    }
    const entries = (shard as Record<string, unknown>).verdicts;
    if (!Array.isArray(entries)) throw new Error('Verdict shard missing "verdicts" array');
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("Verdict entry must be an object");
      }
      const record = entry as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== "string") throw new Error("Verdict entry id must be a string");
      if (map.has(id)) throw new Error(`Verdict id ${id} appears more than once`);
      map.set(id, parseVerdict(record.verdict, id));
    }
  }
  return map;
}

/**
 * Join verdicts back to manifest entries by id. Every manifest comment must have
 * exactly one verdict and every verdict must name a known comment: an unknown,
 * duplicate, or missing id is a hard error, never a silent drop.
 */
export function joinVerdicts(manifest: Manifest, verdicts: Map<string, Verdict>): JoinedItem[] {
  const known = new Set(Object.keys(manifest));
  for (const id of verdicts.keys()) {
    if (!known.has(id)) throw new Error(`Verdict id ${id} has no manifest entry`);
  }
  const items: JoinedItem[] = [];
  const missing: string[] = [];
  for (const [id, entry] of Object.entries(manifest)) {
    const verdict = verdicts.get(id);
    if (!verdict) {
      missing.push(id);
      continue;
    }
    items.push({ id, entry, verdict });
  }
  if (missing.length > 0) {
    throw new Error(`Missing verdicts for ${missing.length} comment(s): ${missing.join(", ")}`);
  }
  return items;
}

/** The current text at a manifest entry's recorded range, or null if out of bounds. */
export function textAtRange(source: string, entry: ManifestEntry): string | null {
  const lines = source.split("\n");
  if (entry.startLine < 1 || entry.endLine > lines.length) return null;
  return sliceRange(
    source,
    lineStartOffsets(lines),
    entry.startLine,
    entry.startColumn,
    entry.endLine,
    entry.endColumn,
  );
}

/** True when the file no longer carries the recorded comment text at its range. */
export function hasDrifted(source: string, entry: ManifestEntry): boolean {
  return textAtRange(source, entry) !== entry.text;
}
