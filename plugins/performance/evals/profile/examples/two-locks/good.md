---
fail: []
---
Workers spend 58.9% of samples in `__psynch_mutexwait` under `cache_get`, plus 12.4% waking waiters on unlock. The journal lock is only 9.7% waiting even though its critical section scans the journal.

1. `cache_get` lock contention (71.3%): shard the cache lock or give each worker its own cache.
2. `route_message` (12.9%): the routing hash.
3. `journal_append` lock wait (9.7%): batch appends.
