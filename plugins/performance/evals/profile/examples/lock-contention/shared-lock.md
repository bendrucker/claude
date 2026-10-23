---
fail: []
---
Together, `stats_record` accounts for 80.7% inclusive. That is every worker queuing on `stats.lock`.

1. **Remove the shared lock from the per-event path, about 84% of CPU.** Give each worker a private histogram and merge after the joins. This eliminates the lock wait (74.8%).
2. **Stop recomputing percentiles on every event, about 5.8%.** `percentile_refresh` runs while holding the lock.
3. **Speed up `score_item`, about 10.3%.**
