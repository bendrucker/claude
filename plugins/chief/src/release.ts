import type { LedgerRow, Presence } from "./types";

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input);
  const [, value, unit] = match ?? [];
  const unitMs = unit === undefined ? undefined : DURATION_UNITS_MS[unit];
  if (value === undefined || unitMs === undefined) throw new Error(`invalid duration: ${input}`);
  return Number(value) * unitMs;
}

function nextTimeOfDay(now: Date, hhmm: string): Date {
  const [hoursPart, minutesPart] = hhmm.split(":");
  if (hoursPart === undefined || minutesPart === undefined) {
    throw new Error(`invalid time of day: ${hhmm}`);
  }
  const candidate = new Date(now);
  candidate.setHours(Number(hoursPart), Number(minutesPart), 0, 0);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function topOfNextHour(now: Date): Date {
  const candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);
  candidate.setHours(candidate.getHours() + 1);
  return candidate;
}

export function nextBoundary(now: Date, presence: Presence): Date {
  const candidates = [topOfNextHour(now)];
  if (presence.busyUntil) candidates.push(new Date(presence.busyUntil));
  return candidates.reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
}

export interface DigestConfig {
  workHours: [string, string];
}

export function nextDigest(now: Date, config: DigestConfig): Date {
  const jobEnd = nextTimeOfDay(now, config.workHours[1]);
  const morning = nextTimeOfDay(now, "08:00");
  return jobEnd < morning ? jobEnd : morning;
}

export function due(rows: LedgerRow[], now: Date): LedgerRow[] {
  return rows.filter(
    (row) => (row.state === "open" || row.state === "held") && new Date(row.releaseAt) <= now,
  );
}
