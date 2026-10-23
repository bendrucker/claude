---
fail: []
---
Workers spend 74% of samples in `__psynch_mutexwait`: they queue on the `stats.lock` mutex in `stats_record`. The work done while holding it is `percentile_refresh`, which rescans 2,048 buckets per event.

1. `stats_record` lock contention (74%): move `percentile_refresh` out from under the lock, or refresh percentiles on read.
2. `score_item` (11%): per-event scoring.
