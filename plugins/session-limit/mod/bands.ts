import type { SessionRateLimit } from "claude-code";
import type { SessionLimitAnnounced } from "../types";

export interface Band {
  threshold: number;
  message: (resetsAt: string | undefined, nowMs: number) => string;
}

export type Announced = SessionLimitAnnounced;

export interface Crossing {
  kind: string;
  threshold: number;
  percentUsed: number;
  resetsAt: string | undefined;
  message: string;
}

// Auto-scheduling a wake-up caps out around an hour. Past this horizon the model
// defers to the user.
const WAKEUP_HORIZON_MS = 55 * 60 * 1000;

export const BANDS: Record<string, Band[]> = {
  five_hour: [
    {
      threshold: 90,
      message: (resetsAt) =>
        `You are at 90% of the current 5-hour usage block (resets ${formatResetTime(resetsAt)}). Favor efficient work and avoid starting large non-essential tasks.`,
    },
    {
      threshold: 95,
      message: (resetsAt) =>
        `You are at 95% of the current 5-hour usage block (resets ${formatResetTime(resetsAt)}). Prefer finishing in-flight work over starting anything new, and batch tool calls.`,
    },
    {
      threshold: 100,
      message: (resetsAt, nowMs) => {
        const reset = formatResetTime(resetsAt);
        const msUntilReset = resetsAt == null ? Number.NaN : Date.parse(resetsAt) - nowMs;
        const withinHorizon = msUntilReset > 0 && msUntilReset <= WAKEUP_HORIZON_MS;
        const resume = withinHorizon
          ? `then schedule a wake-up for just after ${reset} (no need to ask) so work resumes on a fresh block, and stop`
          : `then tell the user to return at ${reset} to resume on a fresh block, and stop`;
        return `The 5-hour usage block is exhausted (resets ${reset}). Every further request now spends overage credits. Finish only in-flight work, ${resume}. Start no new work.`;
      },
    },
  ],
  seven_day: [
    {
      threshold: 95,
      message: (resetsAt) =>
        `You are at 95% of the 7-day usage limit. A 5-hour wait will not restore this. Minimize spend until the weekly reset (${formatResetTime(resetsAt)}).`,
    },
  ],
};

export function formatResetTime(resetsAt: string | undefined): string {
  if (resetsAt == null) return "at an unknown time";
  return new Date(resetsAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function crossedBand(percentUsed: number, bands: readonly Band[]): Band | undefined {
  return bands.findLast((band) => percentUsed >= band.threshold);
}

// A new resetsAt means the block rolled over, so its bands re-arm.
function announcedBand(prev: Announced, kind: string, resetsAt: string): number {
  const entry = prev[kind];
  return entry?.resetsAt === resetsAt ? entry.band : 0;
}

export function evaluate(
  limits: readonly SessionRateLimit[],
  prev: Announced,
  nowMs: number,
): { announced: Announced; crossings: Crossing[] } {
  const announced: Announced = { ...prev };
  const crossings: Crossing[] = [];

  for (const limit of limits) {
    const bands = BANDS[limit.kind];
    if (!bands) continue;

    const resetsAt = limit.resetsAt ?? "";
    const prior = announcedBand(prev, limit.kind, resetsAt);
    announced[limit.kind] = { band: prior, resetsAt };

    // Announce only the highest band crossed, and only once per block.
    const crossed = crossedBand(limit.percentUsed, bands);
    if (!crossed || crossed.threshold <= prior) continue;

    announced[limit.kind] = { band: crossed.threshold, resetsAt };
    crossings.push({
      kind: limit.kind,
      threshold: crossed.threshold,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt,
      message: crossed.message(limit.resetsAt, nowMs),
    });
  }

  return { announced, crossings };
}