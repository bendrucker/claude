# docsync sync Performance Climb

Climbing `docsync sync` on `main`. Accepted changes land as single commits on a `climb/sync` branch.

The brief names `bench/` as the harness, but `bench/fixtures/reference/docsync.lock` matches `bench/fixtures/manifest.json`, so every benchmark run takes the up-to-date exit and never reaches fetch, apply, or index. Users wait on the post-release sync instead: `ci/logs/release-sync-4.2.0.txt` shows 133.60s, with fetch 71.82s and apply 57.89s (relink 41.07s).

## Rules

- Metric: wall time of `docsync sync` right after an upstream release, the run a maintainer waits on before opening the docs PR. assumed: the release-sync scenario, not the up-to-date exit that `bench/` times.
- Ceiling: assumed: 30s.
- Fast signal: assumed: per-phase seconds from the sync's stderr timings.
- Guard: assumed: the rendered `site/reference/` tree and `search-index.json` are byte-identical to the base commit's, checked with `diff -r`.
- Side effects: assumed: archives are served from a local mirror of the 4.2.0 release, and the archive cache is cleared before each run.
- Scope: assumed: code changes only, with the CLI flags and lockfile format unchanged.
  - Parallelism: assumed: in scope. Fetch downloads 38 archives one at a time.
- Inputs: assumed: `dev` is the 4.2.0 release, and `holdout` is the 4.1.0 release.
- Budget: assumed: one working day, with a report at each checkpoint.
- Acceptance: assumed: 10 interleaved runs per side, permutation p < 0.1, median gain of at least 3%, guard passing.
- Stop: assumed: ceiling, three rejections in a row, or budget.

## Checkpoint

The baseline needs a harness the brief does not have, so the climb stops here for review.

1. Build a release-sync harness: a fixture lockfile at 4.1.0 against the 4.2.0 manifest, archives served locally.
2. Record an A/A baseline and profile fetch and apply.
3. Candidates to rank once profiled: parallel fetch, relink from a single walk, incremental index.
