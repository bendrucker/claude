---
fail: [call-tree, short-close]
---
Here's the full trace of a declined-card checkout in this repo (a small mock payments flow, not a real Stripe integration):

**1. Order comes in** — `route.ts:6` calls `checkout(cart)`.

**2. Inventory is held** — `checkout.ts:8` reserves the items before charging anything.

**3. Authorization is attempted** — `checkout.ts:11` calls `authorize(customerId, total)` in `gateway.ts`. The mock gateway declines any amount over 1000:
```ts
if (amount > 1000) throw new CardDeclinedError("insufficient_funds");
```

**4. Checkout catches the failure and cleans up** — `checkout.ts:12-14`:
```ts fragment
} catch (err) {
  await releaseInventory(hold);   // undo the reservation
  throw err;                      // propagate, no retry
}
```
Nothing downstream (loyalty points, shipment, receipt) ever runs.

**5. The route handler converts it to an HTTP response** — `route.ts:8-9`:
```ts
if (err instanceof CardDeclinedError)
  return Response.json({ error: "card_declined", reason: err.reason }, { status: 402 });
```
→ client gets `HTTP 402` with body `{ "error": "card_declined", "reason": "insufficient_funds" }`.

**Notable gaps:** no retry or "try another card" prompt, no partial-failure distinction (a decline during `capture` after auth succeeds goes through the same void-and-release path, `checkout.ts:16-21`), and there's no frontend in this repo — nothing renders that 402 into UI copy for the customer.

One aside: the `show-me` skill you invoked isn't registered in this environment, so I answered by reading the code directly instead.
