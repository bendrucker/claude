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
  rawRewritePending,
  sessionDbPath,
} from "./db";

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

// Rewriting raw holds the write lock for minutes on a large index, so a refresh defers it
// to the nightly --compact while the stamp is fresh. Deferring stops the stamp, so
// without a nightly the rewrite runs inline once the stamp goes stale.
const DEFER_MIN_BYTES = 1024 ** 3;
const DEFER_MAX_STAMP_AGE_MS = 36 * 3600 * 1000;

async function deferRewrite(db: Database): Promise<boolean> {
  return (
    !compact &&
    Bun.file(dbPath).size > DEFER_MIN_BYTES &&
    (await stampAgeMs()) < DEFER_MAX_STAMP_AGE_MS &&
    (await rawRewritePending(db))
  );
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

if (
  !argv.flags.refresh &&
  !compact &&
  (await Bun.file(dbPath).exists()) &&
  (await stampAgeMs()) < argv.flags.maxAge * 1000
) {
  process.stdout.write(`${dbPath}\n`);
  process.exit(0);
}

mkdirSync(dataDir, { recursive: true });

const db = await openWithRetry();
if (db === null) {
  console.error("refresh: another process holds the write lock, using the existing index");
  process.stdout.write(`${dbPath}\n`);
  process.exit(0);
}

let corpusBytes = 0;
let deferred = false;
try {
  deferred = await deferRewrite(db);
  if (!deferred) ({ corpusBytes } = await ensureIndex(db));
} finally {
  db.close();
}

if (deferred) {
  console.error(
    "refresh: deferring the raw rewrite to `refresh.ts --compact`; the index is unchanged",
  );
  process.stdout.write(`${dbPath}\n`);
  process.exit(0);
}

// DuckDB never shrinks a file in place, so a bloated index (from the pre-v3
// full-table rewrites, or pathological churn) is recovered by copying into a
// fresh file. The 64 MiB floor keeps tiny corpora from churning on block overhead.
const dbSize = Bun.file(dbPath).size;
if (compact) {
  console.error(`refresh: compacting ${(dbSize / 1e9).toFixed(1)}GB index`);
  await compactDatabase(dataDir);
} else if (corpusBytes > 0 && dbSize > Math.max(4 * corpusBytes, 64 * 1024 * 1024)) {
  console.error(
    `refresh: compacting ${(dbSize / 1e9).toFixed(1)}GB index against ${(corpusBytes / 1e9).toFixed(1)}GB corpus`,
  );
  await compactDatabase(dataDir);
}

await Bun.write(stampPath, `${new Date().toISOString()}\n`);
process.stdout.write(`${dbPath}\n`);
