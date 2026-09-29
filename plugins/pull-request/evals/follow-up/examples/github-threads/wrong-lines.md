---
fail: [unresolved-window, silent-status]
---
Needs a reply: `src/middleware/rate-limit.ts` line 42 (fixed window) and `src/routes/orders.ts` line 18 (missing await).

Silently resolved: `test/rate-limit.test.ts` (sleeping test) and `src/routes/orders.ts` line 55 (503 status).
