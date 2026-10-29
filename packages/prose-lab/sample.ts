import { type Hit, hitId, type Label, type Queued } from "./data";

export interface Item extends Hit {
  id: string;
  /** Set when a candidate's score queued the hit. */
  pattern?: string;
  candidate?: string;
}

function item(hit: Hit): Item {
  return { ...hit, id: hitId(hit) };
}

/**
 * Hits to label next: every queued candidate hit, then up to `perCheck` hits
 * per check spread across distinct files so one document cannot stand in for
 * the check. Labeled hits are skipped.
 */
export function sample(
  hits: readonly Hit[],
  labels: readonly Label[],
  queue: readonly Queued[],
  perCheck: number,
): Item[] {
  const labeled = new Set(labels.map((label) => label.id));
  const fresh = (hit: Hit): boolean => !labeled.has(hitId(hit));
  const queued = queue.filter(fresh).map(item);
  const spread = [...Map.groupBy(hits.filter(fresh), (hit) => hit.check).values()].flatMap(
    (group) => {
      const byFile = Map.groupBy(group, (hit) => hit.file);
      const files = [...byFile.keys()].toSorted();
      const step = Math.max(1, Math.floor(files.length / perCheck));
      return files
        .filter((_, index) => index % step === 0)
        .slice(0, perCheck)
        .map((file) => byFile.get(file)?.[0])
        .filter((hit) => hit !== undefined);
    },
  );
  return [...queued, ...spread.map(item)];
}
