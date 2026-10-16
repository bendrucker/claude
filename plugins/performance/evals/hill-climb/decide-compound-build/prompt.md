/performance:hill-climb "atlas release build" CLIMB.md

Candidate 2 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `atlas release build` Performance Climb

## Rules

- Metric: wall time of `cargo build --release` from an empty `target/` on the 16-core release runner, which a release waits on.
- Fast signal: `bench/micro atlas-query`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report. Check: `bench/guard.sh`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 4.0% median difference between two unchanged arms, p = 0.61.

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

### Candidate 2: raise codegen units for atlas-query

Hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores.

Target: the metric falls.

Guards: `cargo test --release` passes the same tests as base and `atlas selftest` prints the same report.

Guard check: passed (test outcomes and selftest report identical).
````

## Screen: `compare.ts report tmp/bench/c2-screen --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 54.89s | 1.6% | base |  | 9120.0 |  |
| candidate | 18 | 46.39s | 2.1% | -15.5%* | 0.001 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c2 --markdown`

```
hypothesis: `atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores
load: 2 of 6 rounds above 2×16 cpus (2, 5). Re-run an accept that rests on them

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 212.60s | 1.9% | base |  | 9120.0 |  |
| candidate | 18 | 203.25s | 1.4% | -4.4%* | 0.028 | 9193.0 |  |

without the loaded rounds:
| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 12 | 212.60s | 2.4% | base |  | 9120.0 |  |
| candidate | 12 | 210.90s | 1.6% | -0.8% | 0.560 | 9193.0 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c2/meta.json`

```json
{
  "hypothesis": "`atlas-query` codegen runs on one thread for 28.4% of the critical path. `codegen-units = 16` for that crate spreads it across the runner's cores",
  "started": "2026-10-10T15:04:12.000Z",
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
      "loadBefore": 3.6,
      "loadAfter": 4
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 44,
      "loadAfter": 45.5
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 1.2,
      "loadAfter": 1.6
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 1.5,
      "loadAfter": 1.9
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 44,
      "loadAfter": 45.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.1,
      "loadAfter": 2.5
    }
  ]
}
```
