#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: temporary. Opens the DuckDB index read-write in
// the plugin data dir, which an upstream sandbox defect makes unwritable. Remove this
// when the probe in docs/settings.md succeeds.
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";
import { cli } from "cleye";
import {
  compactDatabase,
  type Database,
  ensureIndex,
  getDataDir,
  getDb,
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
  },
});

const dataDir = getDataDir();
const dbPath = sessionDbPath(dataDir);
const stampPath = path.join(dataDir, "last-refresh");

// Earlier versions kept the index in TMPDIR. Those copies are stale derived
// caches that silently diverge from the real one. Swept only when running
// against the real (derived) data dir: a CLAUDE_PLUGIN_DATA override means a
// test or dev run, which must not delete machine-wide state.
async function cleanupStrayDatabases(): Promise<void> {
  if (process.env.CLAUDE_PLUGIN_DATA) return;
  const strayDirs = new Set([
    path.join(process.env.TMPDIR || "/tmp", "claude-session"),
    "/tmp/claude-session",
  ]);
  for (const dir of strayDirs) {
    if (path.resolve(dir) === path.resolve(dataDir)) continue;
    if (!(await Bun.file(sessionDbPath(dir)).exists())) continue;
    try {
      await rm(dir, { recursive: true, force: true });
      console.error(`refresh: removed stale index at ${dir}`);
    } catch (err) {
      console.error(`refresh: could not remove stale index at ${dir}: ${err}`);
    }
  }
}

async function stampIsFresh(): Promise<boolean> {
  const stamp = Bun.file(stampPath);
  if (!(await stamp.exists())) return false;
  return Date.now() - stamp.lastModified < argv.flags.maxAge * 1000;
}

// The write lock is held by a concurrent refresh (or a lingering reader). A brief
// retry rides out short holders; past that, the concurrent refresher is doing the
// same work, so the existing index is the answer.
async function openWithRetry(): Promise<Database | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb(dataDir);
    } catch (err) {
      if (!/lock/i.test(String(err)) || attempt >= 3) {
        if ((await Bun.file(dbPath).exists()) && /lock/i.test(String(err))) return null;
        throw err;
      }
    }
    await Bun.sleep(250);
  }
}

await cleanupStrayDatabases();

if (!argv.flags.refresh && (await Bun.file(dbPath).exists()) && (await stampIsFresh())) {
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
try {
  ({ corpusBytes } = await ensureIndex(db));
} finally {
  db.close();
}

// DuckDB never shrinks a file in place, so a bloated index (from the pre-v3
// full-table rewrites, or pathological churn) is recovered by copying into a
// fresh file. The 64 MiB floor keeps tiny corpora from churning on block overhead.
const dbSize = Bun.file(dbPath).size;
if (corpusBytes > 0 && dbSize > Math.max(4 * corpusBytes, 64 * 1024 * 1024)) {
  console.error(
    `refresh: compacting ${(dbSize / 1e9).toFixed(1)}GB index against ${(corpusBytes / 1e9).toFixed(1)}GB corpus`,
  );
  await compactDatabase(dataDir);
}

await Bun.write(stampPath, `${new Date().toISOString()}\n`);
process.stdout.write(`${dbPath}\n`);
