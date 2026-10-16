/performance:hill-climb "ripcfg --version" CLIMB.md

Candidate 5 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `ripcfg --version` Performance Climb

## Rules

- Metric: wall time of `ripcfg --version` from a cold process on the 10-core dev laptop, which every shell prompt hook runs.
- Fast signal: `bench/micro telemetry`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: stdout byte-identical to `testdata/version.golden` and exit code 0. Check: `ripcfg --version | cmp - testdata/version.golden`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 1.4% median difference between two unchanged arms, p = 0.38.

## Profile

`go tool pprof -top -cum` of a CPU profile over 200 starts, top entries:

| flat | cum | entry |
| ---: | ---: | --- |
| 0.4% | 96.1% | `main.main` |
| 2.1% | 61.3% | `ripcfg/config.Read` |
| 18.2% | 34.7% | `ripcfg/config.(*Schema).compile` |
| 1.3% | 19.8% | `ripcfg/plugin.discover` |
| 9.6% | 12.4% | `regexp.Compile` |
| 7.7% | 7.7% | `runtime.mallocgc` |
| 0.6% | 5.9% | `ripcfg/telemetry.init` |

## Candidates

### Candidate 5: defer telemetry setup

Hypothesis: `telemetry.init` opens its spool file at start (5.9% cum). Opening it on the first event removes that from `--version`.

Target: the metric falls.

Guards: stdout byte-identical to `testdata/version.golden` and exit code 0.

Guard check: passed (stdout byte-identical, exit 0).
````

## Screen: `compare.ts report tmp/bench/c5-screen --markdown`

```
hypothesis: `telemetry.init` opens its spool file at start (5.9% cum). Opening it on the first event removes that from `--version`

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 10.8ms | 2.1% | base |  | 38.4 |  |
| candidate | 18 | 6.0ms | 1.9% | -44.2%* | 0.001 | 38.6 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c5 --markdown`

```
hypothesis: `telemetry.init` opens its spool file at start (5.9% cum). Opening it on the first event removes that from `--version`
load: no round above 2×10 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 180.2ms | 1.4% | base |  | 38.4 |  |
| candidate | 18 | 148.0ms | 2.4% | -17.9%* | 0.001 | 38.6 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c5/meta.json`

```json
{
  "hypothesis": "`telemetry.init` opens its spool file at start (5.9% cum). Opening it on the first event removes that from `--version`",
  "started": "2026-10-11T16:04:12.000Z",
  "ncpu": 10,
  "arms": [
    {
      "name": "base",
      "command": "./bin/base/ripcfg --version"
    },
    {
      "name": "candidate",
      "command": "./bin/candidate/ripcfg --version"
    }
  ],
  "rounds": [
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 2.3,
      "loadAfter": 2.7
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.6,
      "loadAfter": 3
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 2.9,
      "loadAfter": 3.3
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 3.2,
      "loadAfter": 3.6
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 3.5,
      "loadAfter": 3.9
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 3.8,
      "loadAfter": 4.2
    }
  ]
}
```
