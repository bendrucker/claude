#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/cart.ts <<'TS'
export interface Item {
  sku: string;
  /** Unit price in cents. */
  price: number;
  quantity: number;
}

export class Cart {
  private items: Item[] = [];

  add(item: Item): void {
    this.items.push(item);
  }

  total(): number {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }
}
TS
cat > src/cart.test.ts <<'TS'
import { expect, test } from "bun:test";
import { Cart } from "./cart";

test("total sums price times quantity", () => {
  const cart = new Cart();
  cart.add({ sku: "mug", price: 1200, quantity: 2 });
  expect(cart.total()).toBe(2400);
});
TS
