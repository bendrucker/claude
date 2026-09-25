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
{ "name": "orders", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/orders.ts <<'TS'
export interface Order {
  sku: string;
  quantity: number;
}

export function createOrder(sku: string, quantity: number): Order {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError(`quantity must be 1-100, got ${quantity}`);
  }
  return { sku, quantity };
}

export function updateOrder(order: Order, quantity: number): Order {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError(`quantity must be 1-100, got ${quantity}`);
  }
  return { ...order, quantity };
}
TS
cat > test/orders.test.ts <<'TS'
import { expect, test } from "bun:test";
import { createOrder, updateOrder } from "../src/orders";

test("rejects quantities outside 1-100", () => {
  expect(() => createOrder("a", 0)).toThrow(RangeError);
  expect(() => updateOrder(createOrder("a", 1), 101)).toThrow(RangeError);
});
TS
git add -A && git commit -qm "orders: create and update"
git push -qu origin main
git switch -qc extract-quantity-check
cat > src/orders.ts <<'TS'
export interface Order {
  sku: string;
  quantity: number;
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new RangeError(`quantity must be 1-100, got ${quantity}`);
  }
}

export function createOrder(sku: string, quantity: number): Order {
  assertQuantity(quantity);
  return { sku, quantity };
}

export function updateOrder(order: Order, quantity: number): Order {
  assertQuantity(quantity);
  return { ...order, quantity };
}
TS
git commit -qam "orders: extract the duplicated quantity check"
