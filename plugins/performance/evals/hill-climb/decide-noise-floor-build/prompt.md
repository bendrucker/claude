/performance:hill-climb "atlas release build" CLIMB.md

Candidate 5 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `atlas release build` Performance Climb

## Rules

- Metric: wall time of `cargo build --release` from an empty `target/` on the 16-core release runner, which a release waits on.
- Fast signal: `bench/micro atlas-query`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report. Check: `bench/guard.sh`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 4.8% median difference between two unchanged arms, p = 0.61.

## Profile

`cargo build --release --timings`, units by share of the critical path, top entries:

| flat | cum | entry |
| ---: | ---: | --- |
| 28.4% | 28.4% | `atlas-query (lib) codegen` |
| 17.9% | 17.9% | `serde_derive expansion, all crates` |
| 11.2% | 11.2% | `atlas-proto build.rs (protoc)` |
| 9.8% | 9.8% | `link atlas (bin)` |
| 6.1% | 6.1% | `aws-sdk-s3 (lib)` |
| 4.9% | 4.9% | `openssl-sys build.rs` |

## Candidates

### Candidate 5: raise codegen units for atlas-query

Hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores.

Target: the metric falls.

Guards: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report.

Guard check: passed (test outcomes and selftest report identical).
````

## Screen: `compare.ts report tmp/bench/c5-screen --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 54.89s | 2.1% | base |  | 9120.0 |  |
| candidate | 18 | 48.32s | 1.9% | -12.0%* | 0.001 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c5 --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores
load: no round above 2×16 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 212.60s | 1.4% | base |  | 9120.0 |  |
| candidate | 18 | 205.37s | 2.4% | -3.4%* | 0.067 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c5/meta.json`

```json
{
  "hypothesis": "`atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores",
  "started": "2026-10-11T11:04:12.000Z",
  "ncpu": 16,
  "arms": [
    {
      "name": "base",
      "command": "bench/cold-build.sh base"
    },
    {
      "name": "candidate",
      "command": "bench/cold-build.sh candidate"
    }
  ],
  "rounds": [
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 1.8,
      "loadAfter": 2.2
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.1,
      "loadAfter": 2.5
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 2.4,
      "loadAfter": 2.8
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.7,
      "loadAfter": 3.1
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 3,
      "loadAfter": 3.4
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 3.3,
      "loadAfter": 3.7
    }
  ]
}
```
