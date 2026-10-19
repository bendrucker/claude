#!/usr/bin/env bun
// One incremental refresh of an index copy, run as its own process so the parent can read
// its peak memory. The local host points at a missing directory, which ensureIndex skips,
// so only the import host's changed files are re-read.
import { join } from "node:path";

const [skill = "", dataDir = "", importsDir = ""] = Bun.argv.slice(2);
// oxlint-disable-next-line no-unsafe-assignment -- the arm's own db.ts, typed as this checkout's.
const { ensureIndex, getDb }: typeof import("../../skills/session/scripts/db") = await import(
  join(skill, "scripts", "db.ts")
);
const db = await getDb(dataDir);
const start = performance.now();
const result = await ensureIndex(db, { projectsDir: join(dataDir, "no-local"), importsDir });
db.close();
console.log(JSON.stringify({ ms: performance.now() - start, ...result }));
