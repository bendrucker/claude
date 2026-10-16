`profile.txt` is an allocation profile, so it ranks bytes allocated, not where the p99 latency goes.

The baseline points elsewhere: p50 is 1.9 ms, p99 is 171 ms, and the process uses 0.09 cores. A tail that close to the upstream's 140 ms batch latency suggests requests wait on something. `Cache.refresh` holds the write lock across `pricing.Fetch`, so every `Get` during a refresh blocks.

Before ranking, record a block and mutex profile (`runtime.SetBlockProfileRate`, `SetMutexProfileFraction`) or an execution trace with `go tool trace` during the replay.

1. **Fetch outside the lock and swap the map in** (`Cache.refresh`). Readers keep the old prices until the swap, so the Guard's no-mixing rule holds.
2. **Re-profile with the block profile after 1** and rank what it shows.
3. **Format cents with `strconv.AppendInt`** (`main.cents`, 19% of bytes). Low, since bytes aren't latency.
