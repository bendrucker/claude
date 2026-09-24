#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/money.ts <<'TS'
export function formatMoney(cents: number): string {
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}
TS
cat > src/money.test.ts <<'TS'
import { expect, test } from "bun:test";
import { formatMoney } from "./money";

test("formats thousands with a separator", () => {
  expect(formatMoney(123450)).toBe("$1,234.50");
});
TS
