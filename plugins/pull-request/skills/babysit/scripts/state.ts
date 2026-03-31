#!/usr/bin/env bun

import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { detectProvider } from "../../../scripts/detect-provider";

interface State {
  iteration: number;
  max_iterations: number;
  start_sha?: string;
  cron_job_id?: string;
}

const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
if (!sessionId) {
  console.error("CLAUDE_CODE_SESSION_ID is not set");
  process.exit(1);
}

const tmpdir = process.env.TMPDIR || "/tmp";
const stateDir = join(tmpdir, sessionId);
const statePath = join(stateDir, "babysit-pr-state.json");

const provider = detectProvider();

let state: State;
if (!existsSync(statePath)) {
  mkdirSync(stateDir, { recursive: true });
  state = { iteration: 0, max_iterations: 20 };
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
