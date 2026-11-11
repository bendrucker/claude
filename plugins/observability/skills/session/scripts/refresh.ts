#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: prunes debug logs and mod events under ~/.claude
// and moves a legacy index out of ~/.claude/plugins, both denied to the sandbox.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cli } from "cleye";
import { getDataDir, sessionDbPath } from "./db";
import { checkStamp, recordKilled, refreshIndex } from "./index-writer";

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
const compact = argv.flags.compact;

if (!argv.flags.refresh && !compact && (await checkStamp(dataDir, argv.flags.maxAge * 1000))) {
  process.stdout.write(`${dbPath}\n`);
  process.exit(0);
}

// A rebuild after a schema or views change outlasts an agent's Bash timeout, which kills
// the caller's process group. The worker runs in its own group so the rebuild finishes.
if (process.env.SESSION_REFRESH_WORKER === undefined) {
  const worker = spawn(process.execPath, [import.meta.path, ...process.argv.slice(2)], {
    detached: true,
    env: { ...process.env, SESSION_REFRESH_WORKER: "1" },
    stdio: "inherit",
  });
  await once(worker, "exit");
  // A worker ended by a signal ends the caller the same way. A killed worker records
  // nothing itself, so the caller records it.
  if (worker.signalCode !== null) {
    await recordKilled(worker.signalCode);
    process.kill(process.pid, worker.signalCode);
  }
  process.exit(worker.exitCode ?? undefined);
}

await refreshIndex(dataDir, { compact, yieldToLock: true });
process.stdout.write(`${dbPath}\n`);
