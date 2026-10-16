---
fail: [mismatch, waits, time-split, parallelism, assumed, checkpoint]
---
Wrote the Rules section of `bench/CLIMB.md`. The baseline is 412 ms from `bench/bench.sh`. Next I would profile startup: manifest decoding and the lockfile read.
