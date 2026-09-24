---
fail: [short-close]
---
Here's the full call path for `POST /orders`:

```
server.ts
  routes["POST /orders"] → handleCreateOrder            src/routes/orders.ts:3
    req.json()                                          parses body → {customerId, items}
    createOrder(customerId, items)                      src/orders/create.ts:7
      ├─ validateCart(items)                             src/orders/validate.ts:1
      │    throws on empty cart; sums qty × priceOf(sku) → {items, total}
      │
      ├─ reserveStock(cart)                               src/orders/inventory.ts:3
      │    generates a hold id, bumps in-memory `held` map per sku/qty
      │
      ├─ try:
      │    ├─ chargeCard(customerId, cart.total)          src/payments/charge.ts:3
      │    │     └─ tokenFor(customerId)                  src/payments/vault.ts:1
      │    │           returns `tok_${customerId}` (stubbed)
      │    │     returns { id: `ch_${token}_${amount}` }
      │    │
      │    ├─ persistOrder(customerId, cart, charge.id)   src/orders/store.ts:3
      │    │     pushes {id, customerId, total, chargeId} into in-memory `orders` array
      │    │
      │    └─ sendReceipt(customerId, order)  — fired via `void`, NOT awaited
      │          src/notify/receipt.ts:1 — just console.logs
      │
      └─ catch:
           releaseStock(hold)                            src/orders/inventory.ts:9
             undoes the held-quantity bump, then rethrows

  handleCreateOrder returns Response.json(order, {status: 201})
```

Notable things worth flagging:
- **Everything is in-memory** — `held` (inventory.ts:1) and `orders` (store.ts:1) are module-level arrays/maps, so no real persistence; this only makes sense as a stub/demo.
- **`sendReceipt` is fire-and-forget** (`void sendReceipt(...)`) — a receipt failure is silently swallowed and won't fail the request or get caught by the `try/catch`.
- **No compensation for `persistOrder` failure**: if `persistOrder` throws after a successful charge, `releaseStock` runs but the customer's card was already charged with no refund/void logic — a stripe-canonical-style bug.
- **Payment "vault" is a stub** (`tokenFor` just formats a string, `chargeCard` doesn't call any real processor) — fine for a demo, but not real payment integration.
