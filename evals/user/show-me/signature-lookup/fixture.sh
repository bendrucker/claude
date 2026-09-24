#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/duration.ts <<'TS'
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** Parses strings like "1h30m" or "250ms" into milliseconds. */
export function parseDuration(input: string, options: { allowNegative?: boolean } = {}): number {
  let total = 0;
  for (const [, n, unit] of input.matchAll(/(-?\d+)(ms|s|m|h)/g)) total += Number(n) * UNITS[unit!]!;
  if (total < 0 && !options.allowNegative) throw new RangeError(`negative duration: ${input}`);
  return total;
}

export function formatDuration(ms: number): string {
  return ms >= 3_600_000 ? `${ms / 3_600_000}h` : ms >= 60_000 ? `${ms / 60_000}m` : `${ms}ms`;
}
TS
cat > src/timer.ts <<'TS'
import { parseDuration } from "./duration";
export const timeout = (spec: string) => new Promise((r) => setTimeout(r, parseDuration(spec)));
TS
