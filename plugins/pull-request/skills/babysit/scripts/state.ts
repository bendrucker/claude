#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const sessionId = process.argv[2];
const prNumber = process.argv[3];
const subcommand = process.argv[4];

if (!sessionId || !prNumber) {
  console.error("Usage: state.ts <session-id> <pr-number> [clean]");
  process.exit(1);
}

const stateDir = join(process.env.TMPDIR || "/tmp", sessionId, prNumber);
const statePath = join(stateDir, "babysit.json");

if (subcommand === "clean") {
  await Bun.file(statePath).delete();
  process.exit(0);
}

let iteration: number;
const file = Bun.file(statePath);
if (!(await file.exists())) {
  mkdirSync(stateDir, { recursive: true });
  iteration = 0;
} else {
  iteration = (await file.json()).iteration + 1;
}

await Bun.write(statePath, JSON.stringify({ iteration }));

const max = 20;
console.log(`run ${iteration + 1}/${max}`);
if (iteration >= max) {
  console.log("max_reached: true");
}
