# `kvload` Performance Climb

Climbing the wall time of the nightly order import. Accepted changes land on `main` one commit each.

## Rules

- Metric: wall time of `kvload -in testdata/orders-50k.jsonl -dir "$(mktemp -d)"` on the `ingest` runner (4 vCPU, local NVMe, ext4), from a cold process with the export already on local disk. The finance team waits on the nightly import before the morning reconciliation starts, so this run is the one that matters.
- Ceiling: 2.5 s.
- Fast signal: user plus system CPU time.
- Guard: `orders.wal` and `orders.wal.idx` byte-identical to `testdata/orders-50k.golden/`, exit code 0, and every record durable once `kvload` exits, since the nightly job deletes the export after a zero exit. Check: `cmp` of both files against the golden copies after a run into a fresh directory.
- Side effects: writes only under `-dir`. Reset per run with a fresh temporary directory.
- Scope: any code in this repository, standard library only. The WAL frame format and the index format are fixed.
- Inputs: `dev` `testdata/orders-50k.jsonl` (50,000 orders), `holdout` `testdata/orders-2026-09-30.jsonl` (47,212 orders from a real night).
- Acceptance: 10 interleaved runs per side, permutation p < 0.1 and a median gain of at least 3%, guard passing.
- Stop: the ceiling, three rejections in a row, or the half-day budget.

## Harness

`hyperfine --warmup 1 --runs 10 -N --prepare 'rm -rf /tmp/kv && mkdir /tmp/kv' 'kvload -in testdata/orders-50k.jsonl -dir /tmp/kv'` against a `go build` of each arm, interleaved by `compare.ts run`. The export files live in CI artifact storage and are not checked in.

## Baseline

The current `HEAD`, 2026-10-14, `ingest` runner idle apart from the job.

| Scenario | wall median | spread (IQR) | user + sys |
| --- | ---: | ---: | ---: |
| `dev` orders-50k | 8.62 s | ±1.8% | 2.11 s |
| `holdout` orders-2026-09-30 | 8.17 s | ±2.0% | 1.98 s |

A/A noise floor on `dev`: 2.2% median difference between two unchanged arms, p = 0.58.

## Profile

`profile.txt` is `go tool pprof -top -cum` of a CPU profile recorded on the `dev` scenario at `HEAD` (`-cpuprofile`, same runner).
