---
type: regex
pattern: '^(?=[^\n]*(cache_get|cache_lock|cache lock|cache mutex))(?=[^\n]*(contend|contention|serializ|queu|wait|lock))(?=[^\n]*\b([5-7]\d|80)(\.\d+)?\s?%)'
flags: im
match: contains
---
Waiting on the cache lock is about 55 to 60% of samples, or about 70% with the unlock's wake-ups. The reply puts a share in that range on the cache lock.
