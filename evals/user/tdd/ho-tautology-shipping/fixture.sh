#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/shipping.ts <<'TS'
export const BASE_CENTS = 499;
export const PER_KG_CENTS = 150;

export function shippingCost(weightKg: number): number {
  return BASE_CENTS + Math.ceil(weightKg) * PER_KG_CENTS;
}
TS
