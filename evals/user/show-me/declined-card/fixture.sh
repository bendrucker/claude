#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/checkout src/payments src/loyalty src/shipping src/mail
cat > src/checkout/route.ts <<'TS'
import { checkout } from "./checkout";
import { CardDeclinedError } from "../payments/errors";

export async function handleCheckout(req: Request): Promise<Response> {
  try {
    const order = await checkout(await req.json());
    return Response.json(order, { status: 201 });
  } catch (err) {
    if (err instanceof CardDeclinedError) return Response.json({ error: "card_declined", reason: err.reason }, { status: 402 });
    throw err;
  }
}
TS
cat > src/checkout/checkout.ts <<'TS'
import { authorize, capture, voidAuthorization } from "../payments/gateway";
import { awardPoints } from "../loyalty/points";
import { scheduleShipment } from "../shipping/schedule";
import { sendReceipt } from "../mail/receipt";
import { holdInventory, releaseInventory } from "./inventory";

export async function checkout(cart: { customerId: string; total: number; items: string[] }) {
  const hold = await holdInventory(cart.items);
  let auth;
  try {
    auth = await authorize(cart.customerId, cart.total);
  } catch (err) {
    await releaseInventory(hold);
    throw err;
  }
  try {
    await capture(auth);
  } catch (err) {
    await voidAuthorization(auth);
    await releaseInventory(hold);
    throw err;
  }
  await awardPoints(cart.customerId, cart.total);
  await scheduleShipment(cart.items);
  await sendReceipt(cart.customerId);
  return { id: auth.id, total: cart.total };
}
TS
cat > src/checkout/inventory.ts <<'TS'
export async function holdInventory(items: string[]) {
  return { id: crypto.randomUUID(), items };
}
export async function releaseInventory(hold: { id: string }) {}
TS
cat > src/payments/errors.ts <<'TS'
export class CardDeclinedError extends Error {
  constructor(readonly reason: string) {
    super(`card declined: ${reason}`);
  }
}
TS
cat > src/payments/gateway.ts <<'TS'
import { CardDeclinedError } from "./errors";

export async function authorize(customerId: string, amount: number) {
  if (amount > 1000) throw new CardDeclinedError("insufficient_funds");
  return { id: `auth_${customerId}`, amount };
}
export async function capture(auth: { id: string }) {}
export async function voidAuthorization(auth: { id: string }) {}
TS
cat > src/loyalty/points.ts <<'TS'
export async function awardPoints(customerId: string, total: number) {}
TS
cat > src/shipping/schedule.ts <<'TS'
export async function scheduleShipment(items: string[]) {}
TS
cat > src/mail/receipt.ts <<'TS'
export async function sendReceipt(customerId: string) {}
TS
