#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/routes src/orders src/payments src/notify
cat > src/server.ts <<'TS'
import { handleCreateOrder } from "./routes/orders";

export const routes = { "POST /orders": handleCreateOrder };
TS
cat > src/routes/orders.ts <<'TS'
import { createOrder } from "../orders/create";

export async function handleCreateOrder(req: Request): Promise<Response> {
  const body = await req.json();
  const order = await createOrder(body.customerId, body.items);
  return Response.json(order, { status: 201 });
}
TS
cat > src/orders/create.ts <<'TS'
import { validateCart } from "./validate";
import { reserveStock, releaseStock } from "./inventory";
import { chargeCard } from "../payments/charge";
import { persistOrder } from "./store";
import { sendReceipt } from "../notify/receipt";

export async function createOrder(customerId: string, items: { sku: string; qty: number }[]) {
  const cart = validateCart(items);
  const hold = await reserveStock(cart);
  try {
    const charge = await chargeCard(customerId, cart.total);
    const order = await persistOrder(customerId, cart, charge.id);
    void sendReceipt(customerId, order);
    return order;
  } catch (err) {
    await releaseStock(hold);
    throw err;
  }
}
TS
cat > src/orders/validate.ts <<'TS'
export function validateCart(items: { sku: string; qty: number }[]) {
  if (items.length === 0) throw new Error("empty cart");
  const total = items.reduce((sum, i) => sum + priceOf(i.sku) * i.qty, 0);
  return { items, total };
}

function priceOf(sku: string): number {
  return sku.startsWith("gift-") ? 25 : 10;
}
TS
cat > src/orders/inventory.ts <<'TS'
const held = new Map<string, number>();

export async function reserveStock(cart: { items: { sku: string; qty: number }[] }) {
  const id = crypto.randomUUID();
  for (const i of cart.items) held.set(i.sku, (held.get(i.sku) ?? 0) + i.qty);
  return { id, items: cart.items };
}

export async function releaseStock(hold: { items: { sku: string; qty: number }[] }) {
  for (const i of hold.items) held.set(i.sku, (held.get(i.sku) ?? 0) - i.qty);
}
TS
cat > src/orders/store.ts <<'TS'
const orders: unknown[] = [];

export async function persistOrder(customerId: string, cart: { total: number }, chargeId: string) {
  const order = { id: orders.length + 1, customerId, total: cart.total, chargeId };
  orders.push(order);
  return order;
}
TS
cat > src/payments/charge.ts <<'TS'
import { tokenFor } from "./vault";

export async function chargeCard(customerId: string, amount: number) {
  const token = await tokenFor(customerId);
  return { id: `ch_${token.slice(0, 6)}_${amount}` };
}
TS
cat > src/payments/vault.ts <<'TS'
export async function tokenFor(customerId: string): Promise<string> {
  return `tok_${customerId}`;
}
TS
cat > src/notify/receipt.ts <<'TS'
export async function sendReceipt(customerId: string, order: { id: number }) {
  console.log(`receipt for order ${order.id} to ${customerId}`);
}
TS
