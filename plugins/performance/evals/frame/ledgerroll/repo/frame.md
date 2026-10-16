# `ledgerroll` Performance Climb

Climbing the wall time of the nightly ledger rollup. Accepted changes land on `main` one commit each.

## Rules

- Metric: wall time of `ledgerroll -in feed/2026-10-13.jsonl.gz > ledger.csv` on the `ci-micro` runner (1 vCPU), from a cold process with the feed already on local disk. Finance's close job waits on this step before it can reconcile, and the team watching the close waits with it.
- Ceiling: 2.0 s.
- Fast signal: user plus system CPU time. The baseline below shows CPU at 0.99 of wall, so it tracks the metric.
- Guard: `ledger.csv` byte-identical to `feed/2026-10-13.golden.csv`, and exit code 0. Check: `ledgerroll -in feed/2026-10-13.jsonl.gz | cmp - feed/2026-10-13.golden.csv`.
- Side effects: a run only reads the feed and writes stdout.
- Scope: any code in this repository, standard library only, no new modules. The feed arrives from the upstream payments system as gzipped JSON lines, and neither its compression nor its schema can change. The CSV format is fixed. Parallelism is in scope.
- Inputs: `dev` `feed/2026-10-13.jsonl.gz` (410,000 transactions over 3,900 account and currency groups), `holdout` `feed/2026-09-30.jsonl.gz` (a month-end day, 655,000 transactions).
- Acceptance: 10 interleaved runs per side, permutation p < 0.1 and a median gain of at least 3%, guard passing.
- Stop: the ceiling, three rejections in a row, or the half-day budget.

## Harness

`hyperfine --warmup 1 --runs 10 -N 'ledgerroll -in feed/2026-10-13.jsonl.gz'` against a `go build` of each arm, interleaved by `compare.ts run`. Built with the default `go build` flags, the same build CI runs. The feeds live in CI artifact storage and are not checked in.

## Baseline

The current `HEAD`, 2026-10-14, `ci-micro` runner idle apart from the job.

| Scenario | wall median | spread (IQR) | user + sys |
| --- | ---: | ---: | ---: |
| `dev` 2026-10-13 | 6.08 s | ±1.2% | 6.02 s |
| `holdout` 2026-09-30 | 9.71 s | ±1.5% | 9.63 s |

A/A noise floor on `dev`: 1.6% median difference between two unchanged arms, p = 0.71.

## Profile

`profile.txt` is `go tool pprof -top -cum` of a CPU profile recorded on the `dev` scenario at `HEAD` (`-cpuprofile`, same runner).
