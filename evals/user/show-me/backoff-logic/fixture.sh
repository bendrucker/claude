#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/jobs
cat > src/jobs/schedule.ts <<'TS'
export interface Attempt {
  jobId: string;
  tries: number;
  lastError?: string;
}

const BASE_MS = 2_000;
const MAX_MS = 5 * 60_000;
const MAX_TRIES = 8;

export function nextRun(attempt: Attempt, now: number): number | "give-up" {
  if (attempt.tries >= MAX_TRIES) return "give-up";
  if (attempt.lastError?.startsWith("4")) return "give-up";
  const delay = Math.min(MAX_MS, BASE_MS * 2 ** attempt.tries);
  const jitter = Math.random() * delay * 0.2;
  return now + delay + jitter;
}
TS
cat > src/jobs/runner.ts <<'TS'
import { nextRun, type Attempt } from "./schedule";

export function onFailure(attempt: Attempt, error: string) {
  const at = nextRun({ ...attempt, tries: attempt.tries + 1, lastError: error }, Date.now());
  if (at === "give-up") return moveToGraveyard(attempt.jobId);
  return enqueueAt(attempt.jobId, at);
}
declare function moveToGraveyard(id: string): void;
declare function enqueueAt(id: string, at: number): void;
TS
