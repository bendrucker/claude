# docsync sync Startup Climb

Climbing `docsync sync` startup with the existing hyperfine harness.

## Rules

- Metric: wall time of `./bench/bench.sh`, currently 412 ms.
- Ceiling: 200 ms.
- Fast signal: user CPU time from hyperfine.
- Guard: `docsync sync` prints the same output.
- Side effects: the fixture is offline.
- Scope: code changes.
- Inputs: `dev` is the bench fixture, `holdout` is a second copy of it.
- Budget: two hours.
