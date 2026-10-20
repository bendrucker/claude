import { z } from "zod";
import { readdirSync } from "node:fs";
import type { Database, ScannedFile } from "./db";

export const CatalogRow = z.object({ path: z.string(), mtime: z.bigint(), size: z.bigint() });
export type CatalogRow = z.infer<typeof CatalogRow>;

/** Files tracked under one key of a change catalog: a host's transcripts, or a telemetry source. */
export interface Source {
  catalog: "indexed_files" | "telemetry_files";
  /** The host in indexed_files, the source name in telemetry_files. */
  key: string;
  root: string;
  scan(root: string): ScannedFile[] | Promise<ScannedFile[]>;
  /** Replaces the file's rows, inside the transaction that records it in the catalog. */
  import(db: Database, file: ScannedFile): Promise<void>;
  /** Runs inside the transaction that drops the file from the catalog. */
  remove(db: Database, path: string): Promise<void>;
  /** Bytes the source's files may total before the oldest indexed ones are deleted. */
  cap?: number;
}

export interface Diff {
  scanned: ScannedFile[];
  changed: ScannedFile[];
  removed: CatalogRow[];
}

const KEY = { indexed_files: "host", telemetry_files: "source" } as const;

export function dirExists(target: string): boolean {
  try {
    readdirSync(target);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return false;
  }
}

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

export function indexedFiles(db: Database, source: Source): Promise<CatalogRow[]> {
  return db.query(
    `SELECT path, mtime, size FROM ${source.catalog} WHERE ${KEY[source.catalog]} = $key`,
    CatalogRow,
    { key: source.key },
  );
}

/**
 * Scans the source against its catalog. A missing root is a transient or misconfigured
 * mount, never "every file was deleted", so it returns undefined and the rows stay.
 */
export async function diffSource(db: Database, source: Source): Promise<Diff | undefined> {
  if (!dirExists(source.root)) return undefined;
  const scanned = await source.scan(source.root);
  return { scanned, ...diffCatalog(scanned, await indexedFiles(db, source)) };
}

/** Applies a file's change and its catalog update as one transaction. A stat re-records it. */
async function commit(
  db: Database,
  source: Source,
  path: string,
  change: () => Promise<void>,
  stat?: ScannedFile,
): Promise<void> {
  const key = { key: source.key, path };
  await db.run("BEGIN");
  await change();
  await db.run(
    `DELETE FROM ${source.catalog} WHERE ${KEY[source.catalog]} = $key AND path = $path`,
    key,
  );
  if (stat) {
    await db.run(`INSERT INTO ${source.catalog} VALUES ($key, $path, $mtime, $size)`, {
      ...key,
      mtime: String(stat.mtime),
      size: String(stat.size),
    });
  }
  await db.run("COMMIT");
}

export const reap = (db: Database, source: Source, path: string): Promise<void> =>
  commit(db, source, path, () => source.remove(db, path));

async function stillScans(source: Source, path: string): Promise<boolean> {
  if (!dirExists(source.root)) return false;
  return (await source.scan(source.root)).some((file) => file.path === path);
}

/** Imports changed files and reaps removed ones, each in its own transaction. */
export async function applyDiff(db: Database, source: Source, diff: Diff): Promise<number> {
  for (const file of diff.changed) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh, and each file commits as its own transaction.
      await commit(db, source, file.path, () => source.import(db, file), file);
    } catch (error) {
      // oxlint-disable-next-line no-await-in-loop -- the rollback must land before the next file's BEGIN.
      await db.run("ROLLBACK");
      // A file deleted since the scan is reaped on the next pass.
      // oxlint-disable-next-line no-await-in-loop -- a rare path, rescanned only on failure.
      if (await stillScans(source, file.path)) throw error;
    }
  }
  for (const file of diff.removed) {
    // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh, and each file commits as its own transaction.
    await reap(db, source, file.path);
  }
  return diff.changed.length + diff.removed.length;
}

export async function syncSource(db: Database, source: Source): Promise<number> {
  const diff = await diffSource(db, source);
  return diff === undefined ? 0 : applyDiff(db, source, diff);
}
