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
{ "name": "cart", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/cart.ts <<'TS'
export interface Line {
  priceCents: number;
  quantity: number;
}

export function total(lines: Line[]): number {
  const subtotal = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
  if (subtotal > 10_000) {
    return Math.round(subtotal * 0.9);
  }
  return subtotal;
}
TS
git add -A && git commit -qm "cart: totals with a bulk discount"
git push -qu origin main
git switch -qc extract-discount
cat > src/discount.ts <<'TS'
export const DISCOUNT_THRESHOLD_CENTS = 10_000;

export function applyDiscount(subtotal: number): number {
  return subtotal >= DISCOUNT_THRESHOLD_CENTS ? Math.round(subtotal * 0.9) : subtotal;
}
TS
cat > src/cart.ts <<'TS'
import { applyDiscount } from "./discount";

export interface Line {
  priceCents: number;
  quantity: number;
}

export function total(lines: Line[]): number {
  return applyDiscount(lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0));
}
TS
git add -A && git commit -qm "cart: extract the discount into its own module"
