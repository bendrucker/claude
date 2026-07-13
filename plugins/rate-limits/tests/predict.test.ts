import { describe, expect, test } from "bun:test";
import type { HistorySample, RateLimits } from "../scripts/history";
import type { Marker } from "../scripts/marker";
import { burnRate, evaluate, resolveOptions } from "../scripts/predict";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// A block that resets two hours from `now`, so a series climbing fast enough
// breaches before reset and a shallow one clears it.
const RESET = 2000;
const RESET_MS = RESET * 1000;

function rl(pct: number, resetsAt = RESET): RateLimits {
  return { five_hour: { used_percentage: pct, resets_at: resetsAt } };
}

// Build an in-block series ending `spanMs` before `now`, climbing from `from` to
// `to` percent across `count` evenly spaced points.
function series(
  now: number,
  spanMs: number,
  from: number,
  to: number,
  count: number,
): HistorySample[] {
  const samples: HistorySample[] = [];
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 0 : i / (count - 1);
    samples.push({
      t: now - spanMs + frac * spanMs,
      five: Math.round(from + frac * (to - from)),
      fiveReset: RESET,
      seven: null,
      sevenReset: null,
    });
  }
  return samples;
}

const opts = resolveOptions({ marginMs: 20 * MIN, minSamples: 3, minSpreadMs: 5 * MIN });

describe("evaluate prediction signal", () => {
  test("a steepening series projecting exhaustion before reset emits one prediction", () => {
    const now = RESET_MS - 2 * HOUR;
    // Climbs 20 -> 40 over 40 min => ~30%/hr. From 40% now, +60% takes ~2h, but
    // the fit over a fast recent climb projects exhaustion inside the block.
    const history = series(now, 40 * MIN, 10, 40, 6);
    const result = evaluate(history, rl(40), now, null, opts);
    expect(result).not.toBeNull();
    expect(result?.messages.length).toBe(1);
    expect(result?.messages[0]).toContain("%/hr");
    expect(result?.marker.predictedBreach).toBe(true);
  });

  test("a shallow series that clears reset stays silent", () => {
    const now = RESET_MS - 2 * HOUR;
    // Climbs 38 -> 40 over 40 min => ~3%/hr. From 40%, +60% takes ~20h, well
    // past the 2h-away reset.
    const history = series(now, 40 * MIN, 38, 40, 6);
    const result = evaluate(history, rl(40), now, null, opts);
    expect(result).not.toBeNull();
    expect(result?.messages.length).toBe(0);
    expect(result?.marker.predictedBreach).toBe(false);
  });

  test("too few samples do not fit a slope", () => {
    const now = RESET_MS - 2 * HOUR;
    const history = series(now, 40 * MIN, 10, 40, 2);
    const result = evaluate(history, rl(40), now, null, opts);
    expect(result?.messages.length).toBe(0);
  });

  test("samples too close in time do not fit a slope", () => {
    const now = RESET_MS - 2 * HOUR;
    const history = series(now, 2 * MIN, 10, 40, 6);
    const result = evaluate(history, rl(40), now, null, opts);
    expect(result?.messages.length).toBe(0);
  });
});

describe("cross-surface dedup", () => {
  test("a stamped predicted-breach marker suppresses the next alert for the block", () => {
    const now = RESET_MS - 2 * HOUR;
    const history = series(now, 40 * MIN, 10, 40, 6);

    const first = evaluate(history, rl(40), now, null, opts);
    expect(first?.messages.length).toBe(1);

    // Feed the stamped marker back (as a status query would leave it).
    const second = evaluate(history, rl(40), now, first?.marker ?? null, opts);
    expect(second?.messages.length).toBe(0);
    expect(second?.marker.predictedBreach).toBe(true);
  });

  test("a materially worse projection re-alerts", () => {
    const now = RESET_MS - 2 * HOUR;
    // Climbs ~40%/hr, projecting exhaustion ~89 min out (before the 120-min reset).
    const moderate = series(now, 40 * MIN, 13, 40, 6);
    const first = evaluate(moderate, rl(40), now, null, opts);
    expect(first?.messages.length).toBe(1);

    // A steeper recent climb projects exhaustion far earlier, past the margin.
    const steep = series(now, 40 * MIN, 5, 45, 6);
    const second = evaluate(steep, rl(45), now, first?.marker ?? null, opts);
    expect(second?.messages.length).toBe(1);
  });

  test("a prior block's marker does not suppress a fresh block", () => {
    const now = RESET_MS - 2 * HOUR;
    const history = series(now, 40 * MIN, 10, 40, 6);
    const stale: Marker = { resetsAt: RESET - 9999, predictedBreach: true, alertedEtaMs: now };
    const result = evaluate(history, rl(40), now, stale, opts);
    expect(result?.messages.length).toBe(1);
  });
});

describe("burn rate precision", () => {
  // Real epoch-ms timestamps (~1.77e12) make the uncentered normal equations
  // lose most significant digits near the minimum spread. A perfectly linear
  // block must recover its exact slope regardless of the timestamp magnitude.
  test("recovers a known slope from large epoch-ms timestamps", () => {
    const base = Date.UTC(2026, 0, 1);
    const perMs = 1 / (60 * 1000); // 1%/min
    const spanMs = 5 * MIN;
    const points: HistorySample[] = [];
    for (let i = 0; i < 6; i++) {
      const t = base + (i / 5) * spanMs;
      points.push({
        t,
        five: 40 + (t - base) * perMs,
        fiveReset: RESET,
        seven: null,
        sevenReset: null,
      });
    }
    const rate = burnRate(points, RESET);
    expect(rate).not.toBeNull();
    expect(Math.abs((rate as number) - perMs) / perMs).toBeLessThan(1e-6);
  });
});

describe("exhausted backstop", () => {
  test("fires at 100% independent of any projection", () => {
    const now = RESET_MS - 30 * MIN;
    const result = evaluate([], rl(100), now, null, opts);
    expect(result?.messages.length).toBe(1);
    expect(result?.messages[0]).toContain("exhausted");
  });
});
