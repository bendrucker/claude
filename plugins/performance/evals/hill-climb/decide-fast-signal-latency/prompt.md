/performance:hill-climb "searchd replay" CLIMB.md

Candidate 4 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `searchd replay` Performance Climb

## Rules

- Metric: wall time of `bench/replay.sh`, which sends 2,000 recorded `/search` requests 8 at a time to a local `searchd` on the 8-core staging box. It stands in for the p50 a user waits on.
- Fast signal: `bench/micro score`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: every response body byte-identical to `testdata/replay.golden` and the same status codes. Check: `bench/guard.sh`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 2.2% median difference between two unchanged arms, p = 0.38.

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

### Candidate 4: precompute term weights

Hypothesis: `rank.Score` recomputes each term's IDF per document (38.9% cum). Computing it once when the index opens removes most of that.

Target: the metric falls.

Guards: every response body byte-identical to `testdata/replay.golden` and the same status codes.

Guard check: passed (2,000 of 2,000 responses identical).
````

## Screen: `compare.ts report tmp/bench/c4-screen --markdown`

```
hypothesis: `rank.Score` recomputes each term's IDF per document (38.9% cum). Computing it once when the index opens removes most of that

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 3.04s | 2.4% | base |  | 288.0 |  |
| candidate | 18 | 2.01s | 1.6% | -33.9%* | 0.001 | 291.5 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c4 --markdown`

```
hypothesis: `rank.Score` recomputes each term's IDF per document (38.9% cum). Computing it once when the index opens removes most of that
load: no round above 2×8 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 7.51s | 2.1% | base |  | 288.0 |  |
| candidate | 18 | 7.43s | 1.9% | -1.1% | 0.470 | 291.5 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c4/meta.json`

```json
{
  "hypothesis": "`rank.Score` recomputes each term's IDF per document (38.9% cum). Computing it once when the index opens removes most of that",
  "started": "2026-10-14T14:04:12.000Z",
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
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 2.5,
      "loadAfter": 2.9
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 2.8,
      "loadAfter": 3.2
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 3.1,
      "loadAfter": 3.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 3.4,
      "loadAfter": 3.8
    }
  ]
}
```
