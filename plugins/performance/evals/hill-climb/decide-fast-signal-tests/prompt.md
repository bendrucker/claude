/performance:hill-climb "billing test suite" CLIMB.md

Candidate 3 finished measuring. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `billing test suite` Performance Climb

## Rules

- Metric: wall time of `pytest -q tests/` on the 8-core CI runner, which every PR waits on before review.
- Fast signal: `bench/micro db-fixture`, a microbenchmark of the changed path. Screen with it only. Accept on the metric.
- Guard: the same test IDs pass, fail, and skip as on base, and exit code 0. Check: `bench/junit-diff.sh base candidate`.
- Acceptance: interleaved A/B against the current accepted arm, 6 rounds of 3 runs a side, permutation p < 0.1, a median gain at least the A/A noise floor under Baseline, and the guard passing.

## Baseline

A/A noise floor: 1.4% median difference between two unchanged arms, p = 0.44.

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

### Candidate 3: clone a template database per test

Hypothesis: the `db` fixture runs `create_all` and the migrations for every test (46.2% cum). Migrating one template database per session and cloning it per test removes most of that.

Target: the metric falls.

Guards: the same test IDs pass, fail, and skip as on base, and exit code 0.

Guard check: passed (junit outcomes identical, exit 0).
````

## Screen: `compare.ts report tmp/bench/c3-screen --markdown`

```
hypothesis: the `db` fixture runs `create_all` and the migrations for every test (46.2% cum). Migrating one template database per session and cloning it per test removes most of that

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 43.52s | 1.9% | base |  | 612.0 |  |
| candidate | 18 | 26.90s | 1.4% | -38.2%* | 0.001 | 614.4 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## Full metric: `compare.ts report tmp/bench/c3 --markdown`

```
hypothesis: the `db` fixture runs `create_all` and the migrations for every test (46.2% cum). Migrating one template database per session and cloning it per test removes most of that
load: no round above 2×8 cpus

| arm | n | median | ±MAD | change | p | peak MB | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 18 | 93.07s | 2.4% | base |  | 612.0 |  |
| candidate | 18 | 92.42s | 1.6% | -0.7% | 0.620 | 614.4 |  |

* p < 0.1 and |change| ≥ 3%. † fewer than 4 runs a side, too few to star.
```

## `tmp/bench/c3/meta.json`

```json
{
  "hypothesis": "the `db` fixture runs `create_all` and the migrations for every test (46.2% cum). Migrating one template database per session and cloning it per test removes most of that",
  "started": "2026-10-12T12:04:12.000Z",
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
    },
    {
      "order": [
        "base",
        "candidate"
      ],
      "loadBefore": 1.1,
      "loadAfter": 1.5
    },
    {
      "order": [
        "candidate",
        "base"
      ],
      "loadBefore": 1.4,
      "loadAfter": 1.8
    },
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
    }
  ]
}
```
