#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { getDataDir, sessionDbPath } from "./db";
import { checkStamp, recordKilled, refreshIndex } from "./index-writer";

function number(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

export const program = new Command("refresh")
  .description("Ensure the session index is current and print its path.")
  .option("--refresh", "Rescan even if the index was refreshed within --max-age", false)
  .option(
    "--max-age <seconds>",
    "Seconds a prior refresh stays fresh (skipping the rescan)",
    number,
    300,
  )
  .option(
    "--compact",
    "Compact the database into a fresh copy at STORAGE_VERSION, applying a pending rewrite of raw first. Implies --refresh",
    false,
  );

const flags = (await program.parseAsync()).opts();

const dataDir = getDataDir();
const dbPath = sessionDbPath(dataDir);
const compact = flags.compact;

if (!flags.refresh && !compact && (await checkStamp(dataDir, flags.maxAge * 1000))) {
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
