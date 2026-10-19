#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: prunes debug logs and mod events under ~/.claude
// and moves a legacy index out of ~/.claude/plugins, both denied to the sandbox.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cli } from "cleye";
import {
  compactDatabase,
  type Database,
  ensureIndex,
  getDataDir,
  getDb,
  sessionDbPath,
} from "./db";
import { emit, errorClass } from "./events";

const argv = cli({
  name: "refresh",
  help: {
    description: "Ensure the session index is current and print its path.",
  },
  flags: {
    refresh: {
      type: Boolean,
      description: "Rescan even if the index was refreshed within --max-age",
      default: false,
    },
    maxAge: {
      type: Number,
      description: "Seconds a prior refresh stays fresh (skipping the rescan)",
      default: 300,
    },
    compact: {
      type: Boolean,
      description:
        "Compact the database into a fresh copy at STORAGE_VERSION, applying a pending rewrite of raw first. Implies --refresh",
      default: false,
    },
  },
});

const dataDir = getDataDir();
const dbPath = sessionDbPath(dataDir);
const stampPath = join(dataDir, "last-refresh");

const compact = argv.flags.compact;

async function stampAgeMs(): Promise<number> {
  const stamp = Bun.file(stampPath);
  return (await stamp.exists()) ? Date.now() - stamp.lastModified : Infinity;
}

// The write lock is held by a concurrent refresh (or a lingering reader). A brief
// retry rides out short holders; past that, the concurrent refresher is doing the
// same work, so the existing index is the answer.
async function openWithRetry(): Promise<Database | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retry loop: an attempt runs only because the previous one hit the write lock.
      return await getDb(dataDir);
    } catch (error) {
      if (!/lock/i.test(String(error)) || attempt >= 3) {
        // oxlint-disable-next-line no-await-in-loop -- retry loop: an attempt runs only because the previous one hit the write lock.
        if ((await Bun.file(dbPath).exists()) && /lock/i.test(String(error))) return null;
        throw error;
      }
    }
    // oxlint-disable-next-line no-await-in-loop -- backoff between lock retries.
    await Bun.sleep(250);
  }
}

const started = performance.now();

function report(outcome: string, detail: Record<string, unknown> = {}): Promise<void> {
  return emit({
    event: "refresh",
    ok: outcome !== "error",
    ms: performance.now() - started,
    detail: { outcome, ...detail },
  });
}

if (
  !argv.flags.refresh &&
  !compact &&
  (await Bun.file(dbPath).exists()) &&
  (await stampAgeMs()) < argv.flags.maxAge * 1000
) {
  await report("stamp-fresh");
  process.stdout.write(`${dbPath}\n`);
  process.exit(0);
}

try {
  mkdirSync(dataDir, { recursive: true });

  const db = await openWithRetry();
  if (db === null) {
    console.error("refresh: another process holds the write lock, using the existing index");
    await report("lock-yield");
    process.stdout.write(`${dbPath}\n`);
    process.exit(0);
  }

  const result = await ensureIndex(db).finally(() => {
    db.close();
  });
  const { corpusBytes, changedFiles, removedFiles } = result;
  const phasesMs: Record<string, number> = { ...result.phasesMs };

  // DuckDB never shrinks a file in place, so a bloated index (from the pre-v3
  // full-table rewrites, or pathological churn) is recovered by copying into a
  // fresh file. The 64 MiB floor keeps tiny corpora from churning on block overhead.
  const dbSize = Bun.file(dbPath).size;
  if (compact || (corpusBytes > 0 && dbSize > Math.max(4 * corpusBytes, 64 * 1024 * 1024))) {
    console.error(
      `refresh: compacting ${(dbSize / 1e9).toFixed(1)}GB index against ${(corpusBytes / 1e9).toFixed(1)}GB corpus`,
    );
    const compactStart = performance.now();
    await compactDatabase(dataDir);
    phasesMs.compaction = performance.now() - compactStart;
  }

  await Bun.write(stampPath, `${new Date().toISOString()}\n`);
  await report(phasesMs.compaction === undefined ? "indexed" : "compacted", {
    changed_files: changedFiles,
    removed_files: removedFiles,
    phases_ms: Object.fromEntries(Object.entries(phasesMs).map(([k, v]) => [k, Math.round(v)])),
    db_bytes: Bun.file(dbPath).size,
    corpus_bytes: corpusBytes,
  });
  process.stdout.write(`${dbPath}\n`);
} catch (error) {
  await report("error", { error: errorClass(error) });
  throw error;
}
