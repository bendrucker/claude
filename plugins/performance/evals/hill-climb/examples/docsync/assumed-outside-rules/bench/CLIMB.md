# docsync sync Performance Climb

The `bench/` fixture lockfile matches its manifest, so every benchmark run takes the up-to-date exit and never reaches fetch or apply. A maintainer waits on the post-release sync before opening the docs PR: the 4.2.0 log shows 133.6s, with fetch 71.82s and apply 57.89s.

## Rules

- Metric: wall time of `docsync sync` right after an upstream release.
- Ceiling: assumed: 30s.
- Guard: assumed: the rendered tree is byte-identical to the base commit's.
- Fast signal: per-phase seconds from the stderr timings.
- Scope: code changes only.
- Parallelism: in scope, since fetch downloads 38 archives one at a time.

## Assumptions

- Side effects: assumed: archives come from a local mirror.
- Inputs: assumed: `dev` is 4.2.0 and `holdout` is 4.1.0.
- Budget: assumed: one working day.

## Checkpoint

Build a release-sync harness, then record an A/A baseline.
