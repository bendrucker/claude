import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The usage-limit contract Claude Code pipes to the statusline under its
// `rate_limits` field. The recorder mirrors it to `rl.json` (see the README);
// the alert hook and CLI read it back. Bundled here because plugin code cannot
// import across the plugin boundary.
export interface RateLimitWindow {
  used_percentage?: number;
  resets_at?: number;
}

export interface RateLimits {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

export function expandTilde(target: string): string {
  return target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
}

// One recorded observation. `t` is epoch ms of the sample; `five`/`seven` are
// each window's used_percentage; `fiveReset`/`sevenReset` are the resets_at
// epoch seconds identifying which block each percentage belongs to. A sample
// with a different fiveReset belongs to a later block and must not be fitted
// against the current one.
export interface HistorySample {
  t: number;
  five: number;
  fiveReset: number;
  seven: number | null;
  sevenReset: number | null;
}

// Edge-triggered history keeps only one line per percentage change, so 7 days
// of a single climbing block is at most ~100 lines. The prune horizon bounds it
// regardless.
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export function rateLimitsPath(): string {
  return expandTilde(
    process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH ?? "~/.vibe-island/cache/rl.json",
  );
}

export function historyPath(): string {
  return expandTilde(
    process.env.CLAUDE_RATE_LIMITS_HISTORY_PATH ?? "~/.claude/rate-limits/history.ndjson",
  );
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as T;
  } catch {
    return null;
  }
}

export function readRateLimits(path = rateLimitsPath()): Promise<RateLimits | null> {
  return readJson<RateLimits>(path);
}

export function sampleFromRateLimits(rl: RateLimits, t: number): HistorySample | null {
  const five = rl.five_hour?.used_percentage;
  const fiveReset = rl.five_hour?.resets_at;
  if (typeof five !== "number" || typeof fiveReset !== "number") return null;
  const seven = rl.seven_day?.used_percentage;
  const sevenReset = rl.seven_day?.resets_at;
  return {
    t,
    five,
    fiveReset,
    seven: typeof seven === "number" ? seven : null,
    sevenReset: typeof sevenReset === "number" ? sevenReset : null,
  };
}

function sameObservation(a: HistorySample, b: HistorySample): boolean {
  return (
    a.five === b.five &&
    a.fiveReset === b.fiveReset &&
    a.seven === b.seven &&
    a.sevenReset === b.sevenReset
  );
}

// Concurrent sessions can each append the same observation before either sees
// the other's write, and the edge trigger only guards against the file's prior
// tail. Collapsing runs of identical adjacent observations on read absorbs those
// duplicates and leaves one (time, percentage) point per level for fitting.
function collapse(samples: HistorySample[]): HistorySample[] {
  const out: HistorySample[] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    if (last && sameObservation(last, s)) continue;
    out.push(s);
  }
  return out;
}

export async function readHistory(path = historyPath()): Promise<HistorySample[]> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return [];
  }

  const samples: HistorySample[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const s = JSON.parse(trimmed) as HistorySample;
      if (typeof s.t === "number" && typeof s.five === "number") samples.push(s);
    } catch {
      // Skip a partially written line from a crashed writer and keep reading.
    }
  }

  samples.sort((a, b) => a.t - b.t);
  return collapse(samples);
}

// Append a sample only when the observation differs from the current tail
// (edge trigger), pruning anything older than the 7-day horizon. The write is a
// best-effort full rewrite: a concurrent writer may clobber it, but the next
// append re-reads and re-prunes, so the file self-heals.
export async function appendSample(sample: HistorySample, path = historyPath()): Promise<void> {
  const existing = await readHistory(path);
  const last = existing[existing.length - 1];
  if (last && sameObservation(last, sample)) return;

  const cutoff = sample.t - PRUNE_MS;
  const kept = existing.filter((s) => s.t >= cutoff);
  kept.push(sample);

  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${kept.map((s) => JSON.stringify(s)).join("\n")}\n`);
}
