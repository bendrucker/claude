/performance:hill-climb "billing test suite" CLIMB.md

Candidate 5 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `billing test suite` Performance Climb

## Rules

- Metric: wall time of `pytest -q tests/` on the 8-core CI runner, which every PR waits on before review.
- Fast signal: `bench/micro freeze`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: the same test IDs pass, fail, and skip as on base, and exit code 0. Check: `bench/junit-diff.sh base candidate`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 1.8% median difference between two unchanged arms, p = 0.72.

## Profile

`py-spy record --format raw` over one full run, summarized by cumulative share, top entries:

| flat | cum | entry |
| ---: | ---: | --- |
| 1.2% | 97.8% | `_pytest.main:pytest_runtestloop` |
| 3.1% | 46.2% | `tests/conftest.py:db` |
| 22.4% | 31.0% | `sqlalchemy.sql.schema:MetaData.create_all` |
| 6.2% | 14.8% | `tests/factories.py:InvoiceFactory` |
| 9.9% | 11.3% | `billing/pdf.py:render` |
| 4.1% | 6.1% | `freezegun.api:freeze_time` |

## Candidates

### Candidate 5: swap freezegun for time-machine

Hypothesis: `freeze_time` patches every imported module on entry (6.1% cum). `time-machine` patches the clock in C instead.

Target: the metric falls.

Guards: the same test IDs pass, fail, and skip as on base, and exit code 0.

Guard check: passed (junit outcomes identical, exit 0).
````

## Screen: `compare.ts report tmp/bench/c5-screen --markdown`

```
hypothesis: `freeze_time` patches every imported module on entry (6.1% cum). `time-machine` patches the clock in C instead

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 5.22s | 2.1% | base |  | 612.0 |  |
| candidate | 18 | 2.89s | 1.9% | -44.6%* | 0.001 | 616.9 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c5 --markdown`

```
hypothesis: `freeze_time` patches every imported module on entry (6.1% cum). `time-machine` patches the clock in C instead
load: no round above 2×8 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 94.20s | 1.4% | base |  | 612.0 |  |
| candidate | 18 | 88.17s | 2.4% | -6.4%* | 0.002 | 616.9 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c5/meta.json`

```json
{
  "hypothesis": "`freeze_time` patches every imported module on entry (6.1% cum). `time-machine` patches the clock in C instead",
  "started": "2026-10-11T11:04:12.000Z",
  "ncpu": 8,
  "arms": [
    {
      "name": "base",
      "command": "uv run --project worktrees/base pytest -q tests/"
    },
    {
      "name": "candidate",
      "command": "uv run --project worktrees/candidate pytest -q tests/"
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
