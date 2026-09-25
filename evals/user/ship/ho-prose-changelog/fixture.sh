#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src
cat > package.json <<'JSON'
{ "name": "retry", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/retry.ts <<'TS'
export interface RetryOptions {
  attempts: number;
  baseMs: number;
}

export function delays({ attempts, baseMs }: RetryOptions): number[] {
  return Array.from({ length: attempts }, (_, i) => baseMs * 2 ** i);
}
TS
cat > README.md <<'MD'
# retry

Exponential backoff delays. `delays({ attempts: 3, baseMs: 100 })` returns `[100, 200, 400]`.
MD
cat > CHANGELOG.md <<'MD'
# Changelog

## 1.0.0

- Exponential backoff delays.
MD
git add -A && git commit -qm "retry: backoff delays"
git push -qu origin main
git switch -qc jitter
cat > src/retry.ts <<'TS'
export interface RetryOptions {
  attempts: number;
  baseMs: number;
  jitter?: number;
}

export function delays({ attempts, baseMs, jitter = 0 }: RetryOptions, random = Math.random): number[] {
  return Array.from({ length: attempts }, (_, i) => {
    const delay = baseMs * 2 ** i;
    return Math.round(delay * (1 - jitter + 2 * jitter * random()));
  });
}
TS
cat > README.md <<'MD'
# retry

Exponential backoff delays. `delays({ attempts: 3, baseMs: 100 })` returns `[100, 200, 400]`.

Pass `jitter` between 0 and 1 to spread each delay by up to that fraction in either direction, so clients that failed together do not retry together.
MD
cat > CHANGELOG.md <<'MD'
# Changelog

## 1.1.0

- `jitter` option spreads each delay randomly.

## 1.0.0

- Exponential backoff delays.
MD
git add -A && git commit -qm "retry: add jitter"
