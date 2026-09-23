#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/retry-kit.git
mkdir -p src
cat > src/backoff.ts <<'TS'
export function delay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 5_000);
}
TS
git add -A && git commit -qm "backoff: add exponential delay"
git switch -qc jitter
cat > src/backoff.ts <<'TS'
export function delay(attempt: number): number {
  const cap = Math.min(100 * 2 ** attempt, 20_000);
  return Math.random() * cap;
}
TS
git commit -qam "backoff: use full jitter and raise the cap"
