/performance:hill-climb "atlas release build" CLIMB.md

Candidate 4 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `atlas release build` Performance Climb

## Rules

- Metric: wall time of `cargo build --release` from an empty `target/` on the 16-core release runner, which a release waits on.
- Fast signal: `bench/micro atlas-query`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report. Check: `bench/guard.sh`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 2.5% median difference between two unchanged arms, p = 0.44.

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

### Candidate 4: raise codegen units for atlas-query

Hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores.

Target: the metric falls.

Guards: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report.

Guard check: passed (test outcomes and selftest report identical).
````

## Screen: `compare.ts report tmp/bench/c4-screen --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 54.89s | 2.4% | base |  | 9120.0 |  |
| candidate | 18 | 36.72s | 1.6% | -33.1%* | 0.001 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c4 --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores
load: 6 of 6 rounds above 2×16 cpus (1, 2, 3, 4, 5, 6). Re-run an accept that rests on them

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 212.60s | 2.1% | base |  | 9120.0 |  |
| candidate | 18 | 192.62s | 1.9% | -9.4%* | 0.004 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c4/meta.json`

```json
{
  "hypothesis": "`atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores",
  "started": "2026-10-14T14:04:12.000Z",
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
      "loadBefore": 43,
      "loadAfter": 44.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 35,
      "loadAfter": 36.5
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 39,
      "loadAfter": 40.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 43,
      "loadAfter": 44.5
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 35,
      "loadAfter": 36.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 39,
      "loadAfter": 40.5
    }
  ]
}
```
