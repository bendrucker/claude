import { z } from "zod";
import type { ScannedFile } from "./db";

export const CatalogRow = z.object({ path: z.string(), mtime: z.bigint(), size: z.bigint() });
export type CatalogRow = z.infer<typeof CatalogRow>;

/** Splits a scan against its catalog into files to import and catalog rows to drop. */
export function diffCatalog(
  scanned: ScannedFile[],
  indexed: CatalogRow[],
): { changed: ScannedFile[]; removed: CatalogRow[] } {
  const indexedByPath = new Map(indexed.map((r) => [r.path, r]));
  const scannedPaths = new Set(scanned.map((f) => f.path));
  const changed = scanned.filter((f) => {
    const prev = indexedByPath.get(f.path);
    return !prev || Number(prev.mtime) !== f.mtime || Number(prev.size) !== f.size;
  });
  const removed = indexed.filter((r) => !scannedPaths.has(r.path));
  return { changed, removed };
}
