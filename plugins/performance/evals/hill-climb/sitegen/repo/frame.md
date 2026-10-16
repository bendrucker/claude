# `sitegen` Performance Climb

Climbing the docs preview build. Accepted changes land on `main` one commit each.

## Rules

- Metric: wall time of `bin/sitegen` in the `docs-preview` CI job (4 vCPU runner, fresh checkout, `go build` already done). Every docs PR waits on this job before a reviewer can open the preview link.
- Ceiling: 15 s.
- Fast signal: user plus system CPU time.
- Guard: `public/` byte-identical to the base arm's output for the same commit. Check: `diff -r` of the two output trees.
- Side effects: writes `public/` and `.sitegen-cache/`, and fetches the remote includes. Reset both directories per run, and serve the remote includes from `bench/includes/` through a local server with the recorded response times.
- Scope: any code in this repository, standard library only. Parallelism is in scope. Persisting `.sitegen-cache/` across CI runs is out of scope, since the platform team owns the CI cache quota.
- Inputs: `dev` the `content/` tree at `HEAD`, `holdout` the tree at the `2026-09` release tag.
- Acceptance: 5 interleaved runs per side, permutation p < 0.1 and a median gain of at least 3%, guard passing.
- Stop: the ceiling, three rejections in a row, or the two-day budget.

## Harness

`bench/ci-build.sh` reproduces the CI job on the 4 vCPU `ci-medium` runner: resets `public/` and `.sitegen-cache/`, starts the include server, and times `bin/sitegen`. `compare.ts run` interleaves the arms.

## Baseline

The current `HEAD`, 2026-10-13, `ci-medium` runner.

| Scenario | wall median | spread (IQR) | user + sys |
| --- | ---: | ---: | ---: |
| `dev` HEAD | 64.2 s | ±2.3% | 51.7 s |
| `holdout` 2026-09 | 61.8 s | ±2.6% | 49.9 s |

A/A noise floor on `dev`: 2.9% median difference between two unchanged arms, p = 0.55.

## Profile

`profile.txt` is a CPU profile recorded with `bin/sitegen -cpuprofile cpu.pprof` in the maintainer's working copy at `HEAD`, read with `go tool pprof -top -cum`.
