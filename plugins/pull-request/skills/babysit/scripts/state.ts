#!/usr/bin/env bun

import { join } from "node:path";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { detectProvider } from "../../../scripts/detect-provider";

interface State {
  [key: string]: unknown;
  iteration: number;
  max_iterations: number;
  start_sha?: string;
  cron_job_id?: string;
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: state.ts <session-id> [set <key> <value> | clean]");
  process.exit(1);
}

const tmpdir = process.env.TMPDIR || "/tmp";
const stateDir = join(tmpdir, sessionId);
const statePath = join(stateDir, "babysit-pr-state.json");

const subcommand = process.argv[3];

if (subcommand === "set") {
  const key = process.argv[4];
  const value = process.argv[5];
  if (!key || !value) {
    console.error("Missing value for key: " + key);
    process.exit(1);
  }
  const state: State = JSON.parse(readFileSync(statePath, "utf-8"));
  state[key] = value;
  writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}

if (subcommand === "clean") {
  rmSync(statePath, { force: true });
  process.exit(0);
}

const provider = detectProvider();

let state: State;
if (!existsSync(statePath)) {
  mkdirSync(stateDir, { recursive: true });
  const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  state = { iteration: 0, max_iterations: 20, start_sha: sha };
} else {
  state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.iteration++;
}

writeFileSync(statePath, JSON.stringify(state));

console.log(`iteration: ${state.iteration}`);
console.log(`max_iterations: ${state.max_iterations}`);
console.log(`max_reached: ${state.iteration >= state.max_iterations}`);
console.log(`provider: ${provider}`);
if (state.start_sha) console.log(`start_sha: ${state.start_sha}`);
if (state.cron_job_id) console.log(`cron_job_id: ${state.cron_job_id}`);
