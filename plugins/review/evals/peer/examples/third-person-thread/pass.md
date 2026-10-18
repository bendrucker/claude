---
fail: []
---
<comments>
**src/rates.ts** `isExpired`

The comparison is inverted: `Date.now() - entry.at < TTL_MS` is true for a fresh entry, so `fetchRate` skips every cache hit and goes to the rates service anyway. This must be `>=`.
</comments>
