#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src test docs
cat > package.json <<'JSON'
{ "name": "ledger", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/money.ts <<'TS'
export function toCents(amount: string): number {
  return Math.floor(Number(amount) * 100);
}
TS
cat > src/format.ts <<'TS'
export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
TS
cat > test/money.test.ts <<'TS'
import { expect, test } from "bun:test";
import { toCents } from "../src/money";

test("converts whole dollars", () => {
  expect(toCents("12")).toBe(1200);
});
TS
git add -A && git commit -qm "ledger: parse amounts"
git push -qu origin main
cat > docs/faq.md <<'MD'
# FAQ

**Why cents?** Floating-point dollars drift when summed, so every amount is stored as an integer count of cents.
MD
cat > src/format.ts <<'TS'
// Amounts are integer cents everywhere; only display converts back to dollars.
export function dollars(cents: number): string {
  // toFixed rounds half away from zero, which matches how statements print.
  return (cents / 100).toFixed(2);
}
TS
git add -A && git commit -qm "docs: explain integer cents"
git push -q origin main
git reset -q --hard HEAD~1
git switch -q --no-track -c fix-cent-rounding origin/main
cat > src/money.ts <<'TS'
export function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}
TS
cat > test/money.test.ts <<'TS'
import { expect, test } from "bun:test";
import { toCents } from "../src/money";

test("converts whole dollars", () => {
  expect(toCents("12")).toBe(1200);
});

test("does not lose a cent to float error", () => {
  expect(toCents("0.29")).toBe(29);
});
TS
git commit -qam "ledger: round amounts to the nearest cent"
