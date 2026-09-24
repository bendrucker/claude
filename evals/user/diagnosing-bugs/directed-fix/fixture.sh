#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "retry", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/backoff.ts <<'TS'
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

export function delayFor(attempt: number, { baseMs, maxMs }: BackoffOptions): number {
  const delay = baseMs * 2 ** attempt;
  return delay > maxMs ? maxMs : delay;
}

export function schedule(attempts: number, options: BackoffOptions): number[] {
  return Array.from({ length: attempts }, (_, i) => delayFor(i + 1, options));
}
TS
cat > test/backoff.test.ts <<'TS'
import { expect, test } from "bun:test";
import { schedule } from "../src/backoff";

test("doubles from the base and caps at the max", () => {
  expect(schedule(5, { baseMs: 100, maxMs: 1000 })).toEqual([100, 200, 400, 800, 1000]);
});
TS
git add -A && git commit -qm "retry: exponential backoff"
