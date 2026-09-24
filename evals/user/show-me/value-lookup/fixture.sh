#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/bytes.ts <<'TS'
const UNITS = ["B", "KiB", "MiB", "GiB"];

export function formatBytes(n: number): string {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${UNITS[i]}`;
}
TS
