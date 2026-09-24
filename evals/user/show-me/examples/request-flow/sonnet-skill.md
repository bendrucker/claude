---
fail: [short-close]
---
This is a small custom TypeScript dispatcher (no Express/Nest) — `src/server.ts` maps the string key `"POST /orders"` straight to a handler function, no middleware layer.

```text
handleCreateOrder(req)                       src/routes/orders.ts:3
  parses { customerId, items } from JSON body

  createOrder(customerId, items)             src/orders/create.ts:7
    validateCart(items)                      src/orders/validate.ts:1
      priceOf(sku)                           src/orders/validate.ts:7
    reserveStock(cart)                       src/orders/inventory.ts:3
    chargeCard(customerId, cart.total)       src/payments/charge.ts:3
      tokenFor(customerId)                   src/payments/vault.ts:1
    persistOrder(customerId, cart, chargeId) src/orders/store.ts:3
    sendReceipt(customerId, order)  [fire-and-forget, not awaited]
                                              src/notify/receipt.ts:1
    releaseStock(hold)  [only on error, after reserveStock succeeded]
                                              src/orders/inventory.ts:9

  returns 201 JSON response
```

**Flow:** validate cart total → reserve stock (in-memory hold) → charge card → persist order → fire receipt → return 201. If `chargeCard` or `persistOrder` throws, `releaseStock` compensates for the reserved stock and re-throws.

Worth knowing:
- **No real backing stores** — `orders` (`store.ts:1`) and `held` (`inventory.ts:1`) are plain in-memory `Array`/`Map`, not a DB. Order `id` is `orders.length + 1`, not concurrency-safe.
- **`tokenFor`** (`vault.ts`) is a stub — fabricates `tok_${customerId}`, no real PSP/vault call.
- **`sendReceipt`** (`create.ts:13`) is called with `void` and not awaited or try/caught — a failure there is silently swallowed and won't roll back or fail the request.
- Rollback only covers errors *after* the stock hold (charge/persist); `validateCart` errors happen before any hold exists, so nothing to release.
- No auth, rate-limiting, or schema-validation middleware wraps this route — `validateCart` is the only check.
