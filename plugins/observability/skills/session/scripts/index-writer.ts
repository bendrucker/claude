import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  compactDatabase,
  type Database,
  ensureIndex,
  ensureSchema,
  getDb,
  getReadOnlyDb,
  sessionDbPath,
} from "./db";
import { emit as emitEvent, errorClass, type IndexEvent } from "./events";

export interface WriterDeps {
  open?: (dataDir: string) => Promise<Database>;
  emit?: (event: IndexEvent) => Promise<void>;
  retryDelayMs?: number;
}

type RefreshOutcome = "indexed" | "compacted" | "lock-yield";

export interface RefreshOptions {
  /** Compact into a fresh file even when the size guard would not. */
  compact?: boolean;
  /** Return "lock-yield" instead of throwing when another writer holds an existing index. */
  yieldToLock?: boolean;
  /** How long to wait out another writer before yielding or failing. */
  lockWaitMs?: number;
  /** Recorded on the refresh event when something other than refresh.ts asked. */
  trigger?: string;
  index?: Parameters<typeof ensureIndex>[1];
}

export function stampPath(dataDir: string): string {
  return join(dataDir, "last-refresh");
}

export function isLockError(error: unknown): boolean {
  return /lock/i.test(String(error));
}

function recorder(deps: WriterDeps, extra: Record<string, unknown> = {}) {
  const started = performance.now();
  const emit = deps.emit ?? emitEvent;
  return (outcome: string, detail: Record<string, unknown> = {}): Promise<void> =>
    emit({
      event: "refresh",
      ok: outcome !== "error" && outcome !== "killed",
      ms: performance.now() - started,
      detail: { outcome, ...extra, ...detail },
    });
}

/** Whether a stamp younger than maxAgeMs vouches for an existing index, recording a hit. */
export async function checkStamp(
  dataDir: string,
  maxAgeMs: number,
  deps: WriterDeps = {},
): Promise<boolean> {
  const record = recorder(deps);
  const stamp = Bun.file(stampPath(dataDir));
  if (!(await Bun.file(sessionDbPath(dataDir)).exists()) || !(await stamp.exists())) return false;
  if (Date.now() - stamp.lastModified >= maxAgeMs) return false;
  await record("stamp-fresh");
  return true;
}

export function recordKilled(signal: string, deps: WriterDeps = {}): Promise<void> {
  return recorder(deps)("killed", { signal });
}

// A brief retry rides out short holders, such as a reader finishing a query.
async function openWriter(dataDir: string, deps: WriterDeps, lockWaitMs = 750): Promise<Database> {
  const { open = getDb, retryDelayMs = 250 } = deps;
  const deadline = performance.now() + lockWaitMs;
  await mkdir(dataDir, { recursive: true });
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retry loop: an attempt runs only because the previous one hit the write lock.
      return await open(dataDir);
    } catch (error) {
      if (!isLockError(error) || performance.now() >= deadline) throw error;
    }
    // oxlint-disable-next-line no-await-in-loop -- backoff between lock retries.
    await Bun.sleep(retryDelayMs);
  }
}

export async function refreshIndex(
  dataDir: string,
  options: RefreshOptions = {},
  deps: WriterDeps = {},
): Promise<RefreshOutcome> {
  const record = recorder(deps, options.trigger === undefined ? {} : { trigger: options.trigger });
  const dbPath = sessionDbPath(dataDir);
  try {
    let db: Database;
    try {
      db = await openWriter(dataDir, deps, options.lockWaitMs);
    } catch (error) {
      // A concurrent refresher is doing the same work, so the existing index is the answer.
      if (options.yieldToLock === true && isLockError(error) && (await Bun.file(dbPath).exists())) {
        console.error("refresh: another process holds the write lock, using the existing index");
        await record("lock-yield");
        return "lock-yield";
      }
      throw error;
    }

    const result = await ensureIndex(db, options.index).finally(() => {
      db.close();
    });
    const { corpusBytes, changedFiles, removedFiles, fieldsNew, fieldsGone } = result;
    const phasesMs: Record<string, number> = { ...result.phasesMs };

    // DuckDB never shrinks a file in place, so a bloated index is recovered by copying
    // into a fresh file. The floor keeps tiny corpora from churning on block overhead.
    const dbSize = Bun.file(dbPath).size;
    const compact =
      options.compact === true ||
      (corpusBytes > 0 && dbSize > Math.max(4 * corpusBytes, 64 * 1024 * 1024));
    if (compact) {
      console.error(
        `refresh: compacting ${(dbSize / 1e9).toFixed(1)}GB index against ${(corpusBytes / 1e9).toFixed(1)}GB corpus`,
      );
      const compactStart = performance.now();
      await compactDatabase(dataDir);
      phasesMs.compaction = performance.now() - compactStart;
    }

    await Bun.write(stampPath(dataDir), `${new Date().toISOString()}\n`);
    const outcome = compact ? "compacted" : "indexed";
    await record(outcome, {
      changed_files: changedFiles,
      removed_files: removedFiles,
      phases_ms: Object.fromEntries(Object.entries(phasesMs).map(([k, v]) => [k, Math.round(v)])),
      db_bytes: Bun.file(dbPath).size,
      corpus_bytes: corpusBytes,
      ...(fieldsNew + fieldsGone > 0 && { fields_new: fieldsNew, fields_gone: fieldsGone }),
    });
    return outcome;
  } catch (error) {
    await record("error", { error: errorClass(error) });
    throw error;
  }
}

/** Runs work on a schema-current write connection, closing it after. */
export async function withWriter<T>(
  dataDir: string,
  work: (db: Database) => Promise<T>,
  deps: WriterDeps = {},
): Promise<T> {
  const db = await openWriter(dataDir, deps);
  try {
    await ensureSchema(db);
    return await work(db);
  } finally {
    db.close();
  }
}

/** Runs work on a read-only connection, or returns undefined when there is no index or a writer holds it. */
export async function withReader<T>(
  dataDir: string,
  work: (db: Database) => Promise<T>,
): Promise<T | undefined> {
  if (!(await Bun.file(sessionDbPath(dataDir)).exists())) return undefined;
  let db: Database;
  try {
    db = await getReadOnlyDb(dataDir);
  } catch (error) {
    if (!isLockError(error)) throw error;
    console.error("session index: a refresh holds the index, skipping it");
    return undefined;
  }
  try {
    return await work(db);
  } finally {
    db.close();
  }
}
