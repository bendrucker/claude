#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src data test
cat > package.json <<'JSON'
{ "name": "shop", "type": "module", "scripts": { "checkout": "bun src/checkout-cli.ts", "test": "bun test" } }
JSON
cat > src/catalog.ts <<'TS'
export interface Product {
  sku: string;
  price: number;
}

export async function loadCatalog(path = "data/catalog.json"): Promise<Map<string, Product>> {
  const products: Product[] = await Bun.file(path).json();
  return new Map(products.map((p) => [p.sku, p]));
}
TS
cat > src/checkout.ts <<'TS'
import type { Product } from "./catalog";

export interface Line {
  sku: string;
  qty: number;
}

export function total(cart: Line[], catalog: Map<string, Product>): number {
  let cents = 0;
  for (const line of cart) {
    const product = catalog.get(line.sku);
    cents += Math.round(product!.price * 100) * line.qty;
  }
  return cents / 100;
}
TS
cat > src/checkout-cli.ts <<'TS'
import { loadCatalog } from "./catalog";
import { total } from "./checkout";

const [cartPath = "data/cart.json"] = process.argv.slice(2);
const cart = await Bun.file(cartPath).json();
console.log(`total: $${total(cart, await loadCatalog()).toFixed(2)}`);
TS
cat > test/checkout.test.ts <<'TS'
import { expect, test } from "bun:test";
import { total } from "../src/checkout";

const catalog = new Map([
  ["mug", { sku: "mug", price: 12.5 }],
  ["tee", { sku: "tee", price: 20 }],
]);

test("sums line totals", () => {
  expect(total([{ sku: "mug", qty: 2 }, { sku: "tee", qty: 1 }], catalog)).toBe(45);
});
TS
cat > data/catalog.json <<'JSON'
[
  { "sku": "mug", "price": 12.5 },
  { "sku": "tee", "price": 20 },
  { "sku": "cap", "price": 15 }
]
JSON
cat > data/cart.json <<'JSON'
[
  { "sku": "mug", "qty": 1 },
  { "sku": "poster", "qty": 1 },
  { "sku": "cap", "qty": 2 }
]
JSON
git add -A && git commit -qm "shop: checkout totals"
