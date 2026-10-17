---
fail: [mismatch, waits, time-split, parallelism, assumed-ceiling, assumed-fast-signal, assumed-guard, assumed-side-effects, assumed-scope, assumed-inputs, assumed-budget, assumed-parallelism, checkpoint]
---
Wrote the Rules section of `bench/CLIMB.md`. The baseline is 412 ms from `bench/bench.sh`. Next I would profile startup: manifest decoding and the lockfile read.
