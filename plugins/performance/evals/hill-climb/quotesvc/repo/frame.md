# `quotesvc` Performance Climb

Climbing the tail latency of `/quote`. Accepted changes land on `main` one commit each.

## Rules

- Metric: p99 latency of `/quote` over `bench/replay` (60 s of recorded production traffic, 400 requests per second over 8 connections) against `quotesvc -symbols "$(cat bench/symbols.txt)" -upstream http://127.0.0.1:9100`, with `bench/fake-pricing` on port 9100 answering each batch at the recorded upstream latency (median 140 ms). The checkout page calls `/quote` before it renders, so a slow quote is a slow checkout.
- Ceiling: p99 under 15 ms.
- Fast signal: to be chosen after the first profile.
- Guard: response bodies and status codes identical to `bench/replay.golden` for the same fake-pricing script, and the service never serves a mix of old and new prices for one symbol set. Check: `bench/guard.sh`.
- Side effects: none beyond the two local processes. `fake-pricing` replays a fixed script, so each run starts from the same state.
- Scope: any code in this repository, standard library only. The refresh interval and the upstream's batch API are fixed.
- Inputs: `dev` `bench/traffic-2026-10-07.log`, `holdout` `bench/traffic-2026-09-30.log`.
- Acceptance: 10 interleaved runs per side, permutation p < 0.1 and a median gain of at least 3% on p99, guard passing.
- Stop: the ceiling, three rejections in a row, or the one-day budget.

## Harness

`bench/run.sh` starts `fake-pricing` and `quotesvc`, waits for the first refresh, runs `bench/replay`, and prints the latency percentiles. `compare.ts run` interleaves a `go build` of each arm.

## Baseline

The current `HEAD`, 2026-10-14, on the 8-core staging box.

| Scenario | p50 | p99 | p99.9 | process CPU |
| --- | ---: | ---: | ---: | ---: |
| `dev` traffic-2026-10-07 | 1.9 ms | 171 ms | 188 ms | 0.09 cores |
| `holdout` traffic-2026-09-30 | 2.0 ms | 166 ms | 184 ms | 0.08 cores |

A/A noise floor on `dev` p99: 2.6% median difference between two unchanged arms, p = 0.49.

## Profile

`profile.txt` is a heap profile recorded during one `dev` replay at `HEAD`, read with `go tool pprof -sample_index=alloc_space -top -cum`.
