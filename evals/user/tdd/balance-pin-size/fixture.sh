#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/size.ts <<'TS'
const UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

export function parseSize(input: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMG]?B)\s*$/i.exec(input);
  if (!match) throw new Error(`invalid size: ${input}`);
  const [, amount, unit] = match;
  return Math.round(Number(amount) * UNITS[unit.toUpperCase()]);
}
TS
