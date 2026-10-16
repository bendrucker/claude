/performance:hill-climb "ripcfg --version" CLIMB.md

Candidate 6 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `ripcfg --version` Performance Climb

## Rules

- Metric: wall time of `ripcfg --version` from a cold process on the 10-core dev laptop, which every shell prompt hook runs.
- Fast signal: `bench/micro schema`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
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

### Candidate 6: generate the compiled schema

Hypothesis: `(*Schema).compile` rebuilds the same validator on every start (34.7% cum). Generating it at `go generate` time removes most of that.

Target: the metric falls.

Guards: stdout byte-identical to `testdata/version.golden` and exit code 0.

Guard check: passed (stdout byte-identical, exit 0).
````

## Screen: `compare.ts report tmp/bench/c6-screen --markdown`

```
hypothesis: `(*Schema).compile` rebuilds the same validator on every start (34.7% cum). Generating it at `go generate` time removes most of that

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 63.3ms | 1.4% | base |  | 38.4 |  |
| candidate | 18 | 44.3ms | 2.4% | -30.0%* | 0.001 | 38.6 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c6 --markdown`

```
hypothesis: `(*Schema).compile` rebuilds the same validator on every start (34.7% cum). Generating it at `go generate` time removes most of that
load: no round above 2×10 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 180.2ms | 1.6% | base |  | 38.4 |  |
| candidate | 18 | 161.5ms | 2.1% | -10.4%* | 0.001 | 38.6 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c6/meta.json`

```json
{
  "hypothesis": "`(*Schema).compile` rebuilds the same validator on every start (34.7% cum). Generating it at `go generate` time removes most of that",
  "started": "2026-10-13T18:04:12.000Z",
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
      "loadBefore": 1.7,
      "loadAfter": 2.1
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2,
      "loadAfter": 2.4
    },
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
    }
  ]
}
```
