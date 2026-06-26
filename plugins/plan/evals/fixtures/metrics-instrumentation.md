Our checkout flow has no observability and we're flying blind. We can't tell how slow checkout is or how often it fails, and lately customers have reported slow or failed orders we can't reproduce. We already pay for a statsd-style metrics backend, so I want to instrument the checkout flow so latency and error rates show up there and we can build a dashboard off them.

Here's the relevant code. It's a Node + TypeScript backend. The metrics client is already wired up and used elsewhere in the app.

```
src/
  server.ts              # http server, mounts routes
  routes/
    checkout.ts          # POST /checkout calls services/checkout
  services/
    checkout.ts          # checkout() orchestration (below)
    inventory.ts         # reserveInventory(items) -> Reservation
    orders.ts            # createOrder(...) -> Order
  lib/
    payments.ts          # chargeCard(customerId, amountCents) -> Charge
    metrics.ts           # metrics client (below)
    logger.ts
```

`services/checkout.ts`:

```ts
import { reserveInventory } from "./inventory";
import { createOrder } from "./orders";
import { chargeCard } from "../lib/payments";

export async function checkout(input: CheckoutInput): Promise<Order> {
  const reservation = await reserveInventory(input.items);
  const charge = await chargeCard(input.customerId, input.amountCents);
  const order = await createOrder({
    customerId: input.customerId,
    items: input.items,
    reservationId: reservation.id,
    chargeId: charge.id,
  });
  return order;
}
```

`lib/metrics.ts`:

```ts
export type Tags = Record<string, string>;

export interface Metrics {
  // increment a counter by 1
  increment(name: string, tags?: Tags): void;
  // record a duration in milliseconds
  timing(name: string, ms: number, tags?: Tags): void;
}

export const metrics: Metrics = createStatsdClient(process.env.STATSD_URL);
```

Each of `reserveInventory`, `chargeCard`, and `createOrder` can throw on failure. Right now an error just propagates up out of `checkout()` and gets logged by the route handler. I want the checkout flow only. Plan the implementation.
