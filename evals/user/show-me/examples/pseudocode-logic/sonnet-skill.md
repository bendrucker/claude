This is a per-key token bucket (`src/limits/middleware.ts` + `src/limits/bucket.ts`).

```text
rateLimit(req)
  key  = req["x-api-key"] header, else "anonymous"
  cost = GET → 1, else → 3
  allow(key, cost) ?
    yes → pass request through
    no  → 429 "slow down"

allow(key, cost)
  bucket = buckets[key], or {tokens: 20, updatedAt: now} if new
  elapsed = now - bucket.updatedAt
  bucket.tokens = min(20, bucket.tokens + elapsed * 5/sec)   # refill
  bucket.updatedAt = now
  if bucket.tokens < cost
    save bucket
    return false        # denied, tokens unchanged
  bucket.tokens -= cost
  save bucket
  return true            # allowed, tokens spent
```

Key numbers: capacity **20 tokens**, refill **5/sec**, GET costs **1**, everything else costs **3**. Buckets are keyed by `x-api-key` (or the shared `"anonymous"` bucket if absent) and live in an in-memory `Map`, so limits reset on process restart and aren't shared across instances.
