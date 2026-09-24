#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/pricing
cat > src/pricing/lookup.ts <<'TS'
import { fetchRate } from "./rates";

export async function priceFor(sku: string, currency: string): Promise<number> {
  const base = await basePrice(sku);
  return base * (await fetchRate("USD", currency));
}

async function basePrice(sku: string): Promise<number> {
  const res = await fetch(`https://catalog.internal/skus/${sku}`);
  return (await res.json()).price;
}
TS
cat > src/pricing/rates.ts <<'TS'
export async function fetchRate(from: string, to: string): Promise<number> {
  const res = await fetch(`https://fx.internal/rate?from=${from}&to=${to}`);
  return (await res.json()).rate;
}
TS
