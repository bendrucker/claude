# `logship` Performance Climb

Climbing the wall time of `logship` replaying an incident log. Accepted changes land on `main` one commit each.

## Rules

- Metric: wall time of `logship -in testdata/incident-20k.log > /dev/null` on the `ci-small` runner (2 vCPU, `GOMAXPROCS` left at its default of 2), from a cold process with the log already on local disk. The on-call engineer triggers the incident-replay job and waits for it before reading the replayed records, so this run is the one that matters.
- Ceiling: 1.0 s. Below that the replay finishes before the engineer has the output page open.
- Fast signal: user plus system CPU time. The baseline below shows CPU at 0.99 of wall, so it tracks the metric.
- Guard: stdout byte-identical to `testdata/incident-20k.golden.jsonl` (record order included), the final stderr counter line identical, and exit code 0. Check: `logship -in testdata/incident-20k.log 2>err.txt | cmp - testdata/incident-20k.golden.jsonl && tail -n1 err.txt | cmp - testdata/incident-20k.counters`.
- Side effects: none beyond reading the log and writing stdout and stderr. Nothing to stub or reset.
- Scope: any code in this repository, standard library only, no new modules. Parallelism is in scope (goroutines, worker pools, `GOMAXPROCS`) as long as output order holds. The input format and the JSON output schema are fixed.
- Inputs: `dev` `testdata/incident-20k.log` (20,000 events, about 40% redelivered duplicates), `holdout` `testdata/incident-2026-09.log` (18,400 events from a real incident).
- Acceptance: 10 interleaved runs per side, permutation p < 0.1 and a median gain of at least 3%, guard passing.
- Stop: the ceiling, three rejections in a row, or the half-day budget.

## Harness

`hyperfine --warmup 1 --runs 10 -N 'logship -in testdata/incident-20k.log'` against a `go build` of each arm, interleaved by `compare.ts run`. Built with the default `go build` flags, the same build CI runs. The log files live in CI artifact storage and are not checked in.

## Baseline

The current `HEAD`, 2026-10-14, `ci-small` runner idle apart from the job.

| Scenario | wall median | spread (IQR) | user + sys |
| --- | ---: | ---: | ---: |
| `dev` incident-20k | 4.16 s | ±1.4% | 4.12 s |
| `holdout` incident-2026-09 | 3.71 s | ±1.6% | 3.68 s |

A/A noise floor on `dev`: 1.9% median difference between two unchanged arms, p = 0.62.

## Profile

`profile.txt` is `go tool pprof -top -cum` of a CPU profile recorded on the `dev` scenario at `HEAD` (`-cpuprofile`, same runner).
