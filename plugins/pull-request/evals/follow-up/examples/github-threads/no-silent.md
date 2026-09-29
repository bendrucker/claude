---
fail: [silent-test, silent-status]
---
Two threads on #247 still need replies:

- `src/middleware/rate-limit.ts:39`: fixed window allows bursts across the boundary.
- `src/routes/orders.ts:18`: the limiter check is not awaited.

Everything else is resolved.
