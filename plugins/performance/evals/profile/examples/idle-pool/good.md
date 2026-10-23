---
fail: []
---
All the work runs on the main thread: `decode_block` is 94.0% of CPU and `checksum` 5.4%. The six pool workers sit idle in `pthread_cond_wait` and the flusher sleeps, so their waits cost nothing.

1. `decode_block` (94.0%): spread it across the idle pool workers, or make the generator cheaper.
2. `checksum` (5.4%).
