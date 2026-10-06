import type { SessionRateLimit } from "claude-code";

export interface Band {
  threshold: number;
  message: (resetsAt: string | undefined, nowMs: number) => string;
}

export type Announced = Record<string, { band: number; resetsAt: string }>;

export interface Crossing {
  kind: string;
  threshold: number;
  percentUsed: number;
  resetsAt: string | undefined;
  message: string;
}

// Auto-scheduling a wake-up caps out around an hour. Past this horizon the model
// defers to the user instead of scheduling.
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

const LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

export function formatResetTime(resetsAt: string | undefined): string {
  if (resetsAt == null) return "at an unknown time";
  return new Date(resetsAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function statusText(limits: readonly SessionRateLimit[]): string | undefined {
  const parts = limits
    .filter((limit) => limit.kind in LABELS)
    .map((limit) => `${LABELS[limit.kind]} ${Math.round(limit.percentUsed)}%`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function crossedBand(percentUsed: number, bands: readonly Band[]): Band | undefined {
  return bands.findLast((band) => percentUsed >= band.threshold);
}

// A window's band re-arms when its resetsAt changes, since that means the block rolled over.
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
    const prior = prev[limit.kind]?.resetsAt === resetsAt ? (prev[limit.kind]?.band ?? 0) : 0;
    announced[limit.kind] = { band: prior, resetsAt };
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
