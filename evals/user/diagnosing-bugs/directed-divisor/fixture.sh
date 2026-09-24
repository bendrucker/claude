#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "money", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/format.ts <<'TS'
export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 10);
}
TS
cat > test/format.test.ts <<'TS'
import { expect, test } from "bun:test";
import { formatPrice } from "../src/format";

test("formats cents as dollars", () => {
  expect(formatPrice(1999)).toBe("$19.99");
});
TS
git add -A && git commit -qm "money: price formatting"
