---
fail: [dedupe-top5, no-trap-top2]
---
The pipeline is serial and the counters sit behind a lock every event takes, so start with concurrency.

1. Run `fanOut` concurrently, as its TODO asks, with one goroutine per region.
2. Shard the `Stats` mutex so the per-event `Inc` stops contending with the reporter.
3. Hoist the `regexp.MustCompile` calls out of `parseLine` and `normalizeHost`.
4. Buffer stdout in larger chunks.
