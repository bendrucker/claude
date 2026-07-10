import type { HistorySample, RateLimits } from "./history";
import type { Marker } from "./marker";

// Sensitivity knobs. `marginMs` is how far before reset a projected exhaustion
// must land to be worth alerting (and doubles as the re-alert threshold: a
// projection has to move at least this much earlier to fire again). `minSamples`
// and `minSpreadMs` guard against fitting a slope through integer-percentage
// noise: too few points, or points too close in time, and a one-percent tick
// reads as a runaway rate.
export interface PredictOptions {
  marginMs: number;
  minSamples: number;
  minSpreadMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveOptions(overrides: Partial<PredictOptions> = {}): PredictOptions {
  return {
    marginMs: overrides.marginMs ?? envInt("CLAUDE_RATE_LIMITS_MARGIN_MS", 20 * 60 * 1000),
    minSamples: overrides.minSamples ?? envInt("CLAUDE_RATE_LIMITS_MIN_SAMPLES", 3),
    minSpreadMs: overrides.minSpreadMs ?? envInt("CLAUDE_RATE_LIMITS_MIN_SPREAD_MS", 5 * 60 * 1000),
  };
}

// Auto-scheduling a wake-up caps out around an hour. Past this horizon the model
// defers to the user instead of scheduling.
const WAKEUP_HORIZON_MS = 55 * 60 * 1000;

export function formatResetTime(resetsAtSeconds: number): string {
  return new Date(resetsAtSeconds * 1000).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Point {
  t: number;
  pct: number;
}

// Samples belonging to the given block, as (time, percentage) points. A block is
// identified by its resets_at, so only samples whose fiveReset matches the
// window are fitted together.
export function inBlockPoints(samples: HistorySample[], window: number): Point[] {
  return samples.filter((s) => s.fiveReset === window).map((s) => ({ t: s.t, pct: s.five }));
}

// Least-squares slope of percentage over wall-clock ms (%/ms). Null when fewer
// than two distinct time points exist, which leaves the slope undefined.
export function burnRate(samples: HistorySample[], window: number): number | null {
  return slope(inBlockPoints(samples, window));
}

function slope(points: Point[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumT = 0;
  let sumP = 0;
  let sumTT = 0;
  let sumTP = 0;
  for (const p of points) {
    sumT += p.t;
    sumP += p.pct;
    sumTT += p.t * p.t;
    sumTP += p.t * p.pct;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;
  return (n * sumTP - sumT * sumP) / denom;
}

function timeSpread(points: Point[]): number {
  if (points.length < 2) return 0;
  let min = points[0].t;
  let max = points[0].t;
  for (const p of points) {
    if (p.t < min) min = p.t;
    if (p.t > max) max = p.t;
  }
  return max - min;
}

// Projected epoch ms at which the fitted line reaches 100%. Null when the slope
// is non-positive, since a flat or declining line never reaches the ceiling.
export function predictExhaustion(pct: number, slopePerMs: number, nowMs: number): number | null {
  if (slopePerMs <= 0) return null;
  const remaining = 100 - pct;
  if (remaining <= 0) return nowMs;
  return nowMs + remaining / slopePerMs;
}

export interface Projection {
  slopePerMs: number;
  etaMs: number;
}

// Fit the current block and project its exhaustion, or null when the guards
// (sample count, time spread, positive slope) are not met. Shared by the alert
// hook and the status query so both read the same rate.
export function project(
  history: HistorySample[],
  rl: RateLimits,
  nowMs: number,
  opts: PredictOptions = resolveOptions(),
): Projection | null {
  const fivePct = rl.five_hour?.used_percentage;
  const fiveReset = rl.five_hour?.resets_at;
  if (typeof fivePct !== "number" || typeof fiveReset !== "number") return null;

  const points = inBlockPoints(history, fiveReset);
  if (points.length < opts.minSamples) return null;
  if (timeSpread(points) < opts.minSpreadMs) return null;

  const slopePerMs = slope(points);
  if (slopePerMs === null || slopePerMs <= 0) return null;

  const etaMs = predictExhaustion(fivePct, slopePerMs, nowMs);
  if (etaMs === null) return null;

  return { slopePerMs, etaMs };
}

function predictionMessage(pct: number, proj: Projection, resetSeconds: number): string {
  const perHour = proj.slopePerMs * 60 * 60 * 1000;
  const etaLabel = formatResetTime(Math.round(proj.etaMs / 1000));
  const minsBefore = Math.round((resetSeconds * 1000 - proj.etaMs) / 60000);
  return (
    `Usage is climbing ~${perHour.toFixed(0)}%/hr. At ${pct}% now, the 5-hour usage limit ` +
    `is projected to run out around ${etaLabel} — about ${minsBefore} min before it resets ` +
    `(${formatResetTime(resetSeconds)}). Pace large tasks or finish critical work first so you ` +
    `do not stall mid-task.`
  );
}

function exhaustedMessage(resetSeconds: number, nowMs: number): string {
  const reset = formatResetTime(resetSeconds);
  // A stale mirror can hold a resets_at already in the past. A negative
  // remaining time must not read as "within horizon" and schedule a wake-up for
  // a moment that has elapsed.
  const msUntilReset = resetSeconds * 1000 - nowMs;
  const withinHorizon = msUntilReset > 0 && msUntilReset <= WAKEUP_HORIZON_MS;
  const resume = withinHorizon
    ? `then schedule a wake-up for just after ${reset} (no need to ask) so work resumes on a fresh block, and stop`
    : `then tell the user to return at ${reset} to resume on a fresh block, and stop`;
  return (
    `The 5-hour usage limit is exhausted (resets ${reset}). Every further request now spends ` +
    `overage. Finish only in-flight work, ${resume}. Start no new work.`
  );
}

export interface EvalResult {
  marker: Marker;
  messages: string[];
}

// Decide what guidance to inject and what marker to persist. Returns null when
// no usage-limit data is available. The prediction fires when a positive burn
// rate projects exhaustion more than `marginMs` before reset, deduped per block
// via the marker so it does not repeat every prompt (a materially earlier
// projection re-alerts). The 100%-exhausted backstop fires independently of the
// projection.
export function evaluate(
  history: HistorySample[],
  rl: RateLimits,
  nowMs: number,
  prev: Marker | null,
  opts: PredictOptions = resolveOptions(),
): EvalResult | null {
  const fivePct = rl.five_hour?.used_percentage;
  if (typeof fivePct !== "number") return null;

  const fiveReset = rl.five_hour?.resets_at ?? 0;
  const resetMs = fiveReset * 1000;

  const prior = prev && prev.resetsAt === fiveReset ? prev : null;
  let predictedBreach = prior?.predictedBreach ?? false;
  let alertedEtaMs = prior?.alertedEtaMs ?? null;
  const messages: string[] = [];

  if (fivePct >= 100) {
    messages.push(exhaustedMessage(fiveReset, nowMs));
  } else {
    const proj = project(history, rl, nowMs, opts);
    if (proj && proj.etaMs < resetMs - opts.marginMs) {
      const firstAlert = !predictedBreach;
      const materiallyWorse = alertedEtaMs !== null && proj.etaMs < alertedEtaMs - opts.marginMs;
      if (firstAlert || materiallyWorse) {
        messages.push(predictionMessage(fivePct, proj, fiveReset));
        alertedEtaMs = proj.etaMs;
      }
      predictedBreach = true;
    }
  }

  return {
    marker: { resetsAt: fiveReset, predictedBreach, alertedEtaMs },
    messages,
  };
}
