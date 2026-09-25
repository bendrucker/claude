#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "money", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/money.ts <<'TS'
export function splitCents(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
TS
cat > test/money.test.ts <<'TS'
import { expect, test } from "bun:test";
import { splitCents } from "../src/money";

test("splits evenly", () => {
  expect(splitCents(300, 3)).toEqual([100, 100, 100]);
});
TS
git add -A && git commit -qm "money: split cents"
git push -qu origin main
git switch -qc split-remainder-tests
cat > test/money.test.ts <<'TS'
import { expect, test } from "bun:test";
import { splitCents } from "../src/money";

test("splits evenly", () => {
  expect(splitCents(300, 3)).toEqual([100, 100, 100]);
});

test("gives the remainder to the first parts", () => {
  expect(splitCents(100, 3)).toEqual([34, 33, 33]);
});

test("always sums to the total", () => {
  for (const total of [0, 1, 99, 1001]) {
    expect(splitCents(total, 7).reduce((a, b) => a + b, 0)).toBe(total);
  }
});
TS
git commit -qam "money: cover remainders"
