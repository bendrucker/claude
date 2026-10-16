/performance:hill-climb "searchd replay" CLIMB.md

Candidate 6 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `searchd replay` Performance Climb

## Rules

- Metric: wall time of `bench/replay.sh`, which sends 2,000 recorded `/search` requests 8 at a time to a local `searchd` on the 8-core staging box. It stands in for the p50 a user waits on.
- Fast signal: `bench/micro accesslog`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: every response body byte-identical to `testdata/replay.golden` and the same status codes. Check: `bench/guard.sh`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 2.2% median difference between two unchanged arms, p = 0.44.

## Profile

`go tool pprof -top -cum` of a CPU profile over one replay, top entries:

| flat | cum | entry |
| ---: | ---: | --- |
| 1.2% | 92.4% | `net/http.(*conn).serve` |
| 21.7% | 38.9% | `searchd/rank.Score` |
| 8.8% | 17.3% | `encoding/json.Marshal` |
| 11.4% | 14.2% | `searchd/index.(*Postings).Intersect` |
| 9.1% | 11.0% | `compress/gzip.(*Writer).Write` |
| 1.0% | 5.2% | `searchd/log.Access` |

## Candidates

### Candidate 6: buffer the access log

Hypothesis: `log.Access` writes one unbuffered line per request (5.2% cum). A buffered writer flushed each second removes the per-request syscall.

Target: the metric falls.

Guards: every response body byte-identical to `testdata/replay.golden` and the same status codes.

Guard check: passed (2,000 of 2,000 responses identical).
````

## Screen: `compare.ts report tmp/bench/c6-screen --markdown`

```
hypothesis: `log.Access` writes one unbuffered line per request (5.2% cum). A buffered writer flushed each second removes the per-request syscall

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 406.1ms | 1.4% | base |  | 288.0 |  |
| candidate | 18 | 246.5ms | 2.4% | -39.3%* | 0.001 | 291.5 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c6 --markdown`

```
hypothesis: `log.Access` writes one unbuffered line per request (5.2% cum). A buffered writer flushed each second removes the per-request syscall
load: no round above 2×8 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 7.51s | 1.6% | base |  | 288.0 |  |
| candidate | 18 | 6.34s | 2.1% | -15.6%* | 0.002 | 291.5 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c6/meta.json`

```json
{
  "hypothesis": "`log.Access` writes one unbuffered line per request (5.2% cum). A buffered writer flushed each second removes the per-request syscall",
  "started": "2026-10-13T18:04:12.000Z",
  "ncpu": 8,
  "arms": [
    {
      "name": "base",
      "command": "bench/replay.sh base"
    },
    {
      "name": "candidate",
      "command": "bench/replay.sh candidate"
    }
  ],
  "rounds": [
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 3.7,
      "loadAfter": 4.1
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 4,
      "loadAfter": 4.4
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 1.3,
      "loadAfter": 1.7
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 1.6,
      "loadAfter": 2
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 1.9,
      "loadAfter": 2.3
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.2,
      "loadAfter": 2.6
    }
  ]
}
```
