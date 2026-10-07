**Rate-limit order creation per tenant** (#247): 6 review threads.

| State | Count |
| --- | --- |
| Unresolved, no reply | 2 |
| Unresolved, replied | 1 |
| Resolved, with reply | 1 |
| Resolved, silent | 2 |

## Needs a reply

- `src/middleware/rate-limit.ts:39` (@mchen, Sep 24): the fixed window lets a tenant send twice the limit across a boundary. Asks for a sliding window or token bucket. No commit since.
- `src/routes/orders.ts:18` (coderabbitai, Sep 21): `limiter.check()` was not awaited. Commit "orders: await the limiter check" (Sep 22) fixes it, so this only needs a short reply and a resolve.

## Waiting on the reviewer

- `src/config.ts:6` (@mchen): per-tenant limits. You replied that it's tracked in #251.

## Silently resolved

- `test/rate-limit.test.ts:31` (@priya-k): the test sleeps two real seconds. Resolved with no reply and the sleep is still there.
- `src/routes/orders.ts:54` (@mchen): return 429 with `Retry-After` instead of 503. Resolved with no reply, and `tooManyRequests` still returns 503.

Want me to draft replies for the two open threads?
