---
fail: [pseudocode]
---
Here's the full decision path across two files, keyed by request (`src/limits/middleware.ts` → `src/limits/bucket.ts`):

**1. Entry point** (`middleware.ts:3-6`)
- Bucket key = `x-api-key` header, or `"anonymous"` if missing — so all unauthenticated traffic shares **one** bucket.
- Cost per request: `GET` = 1 token, everything else (POST/PUT/DELETE/etc.) = 3 tokens.
- Calls `allow(key, cost)`; if it returns `false`, responds `429 slow down`.

**2. Token bucket algorithm** (`bucket.ts:12-25`)
- Classic token-bucket, one bucket per key, held in an in-memory `Map` (not persisted — resets on restart, and won't be shared across multiple instances).
- Constants: `CAPACITY = 20` tokens max, `REFILL_PER_SECOND = 5` tokens/sec.
- On each call:
  1. Look up the bucket, or initialize a fresh one at full capacity (`20` tokens) if the key is new.
  2. Compute elapsed seconds since last update, refill `elapsed * 5` tokens, capped at `20`.
  3. If `tokens < cost` → reject (bucket is still saved with the refilled-but-not-decremented amount).
  4. Otherwise subtract `cost` and allow.

**Net effect:** each key gets a burst allowance of 20 "cheap" (GET) requests, sustained at 5/sec; write-type requests cost 3x as much, so sustained throughput for writes is effectively ~1.67/sec with bursts up to 6.

One thing worth flagging: since all unauthenticated requests collapse to the `"anonymous"` key, they all compete for a single shared bucket — that's likely intentional but worth confirming if you're expecting per-IP fairness instead.
