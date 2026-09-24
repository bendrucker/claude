#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/duration.ts <<'TS'
const HOUR = 3_600_000;
const MINUTE = 60_000;

export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}
TS
cat > src/duration.test.ts <<'TS'
import { expect, test } from "bun:test";
import { formatDuration } from "./duration";

test("formats hours and minutes", () => {
  expect(formatDuration(5_400_000)).toBe("1h30m");
});
TS
