import type { ScannedFile } from "./db";

export const MiB = 1024 * 1024;

/**
 * The oldest deletable files to delete so all files total at most `cap` bytes, as near
 * as the deletable ones allow.
 */
export function overCap(
  files: readonly ScannedFile[],
  cap: number,
  isDeletable: (file: ScannedFile) => boolean = () => true,
): ScannedFile[] {
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const doomed: ScannedFile[] = [];
  for (const file of files.toSorted((a, b) => a.mtime - b.mtime)) {
    if (total <= cap) break;
    if (!isDeletable(file)) continue;
    doomed.push(file);
    total -= file.size;
  }
  return doomed;
}
