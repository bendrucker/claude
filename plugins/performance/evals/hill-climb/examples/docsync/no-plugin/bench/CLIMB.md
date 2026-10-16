# Hill-climb: `docsync sync`

Nothing has been built or run yet. This file is the Frame only: rules, findings from reading the code, and the plan for the baseline and first candidates.

## Rules

- **Metric:** wall time of one full `docsync sync` on a representative release (lower is better). Report median and min over the runs, plus the per-phase stderr timings (resolve, fetch, apply/relink, index).
- **Correctness gate:** after every run the output tree (`*.md`, `search-index.json`, `docsync.lock`) must hash identically to the baseline's output tree. A candidate that changes the hash is rejected, however fast it is.
- **One change per candidate.** Measure it against the current best. Keep it only if it wins by more than the noise (about 2x the baseline stddev), and commit each kept candidate separately. Revert the rest and log them anyway.
- **No network in the loop.** Archives are pre-seeded into a throwaway cache, so fetch measures cache-hit cost only. Network fetch is not benchmarked here (see Risks).
- **Isolate state.** Each run uses a fresh copy of the tree and an empty lock (`hyperfine --prepare`). Point `HOME` at a temp dir so `os.UserCacheDir()` doesn't touch the real cache. Never write into `bench/fixtures/`.
- **Don't edit the harness mid-climb** once the baseline is recorded. If it has to change, re-baseline and say so in the log.
- **Stop** after 3 consecutive candidates with no keepable win, or when the remaining time is mostly fetch/network, which this harness can't measure.
- Log every candidate below: idea, result, kept or reverted.

## Findings from reading the code

1. **The current harness measures the wrong path.** `bench/fixtures/reference/docsync.lock` has the same digests as `manifest.json`, so `lock.changed()` returns nothing. `sync` prints `up to date with 4.2.0` and exits after resolve. It never runs fetch, apply, relink or index. The path it does time is a manifest parse and a small lock read. A 412 ms figure for that is itself suspicious, and I haven't checked it. Any optimization to apply, relink or fetch would show zero change on it.
2. **Also not repeatable if it did work.** A real sync rewrites `docsync.lock` in the fixture and mutates the tree, so every run after the first would be a no-op.
3. **The real workload is a release sync.** `ci/logs/release-sync-4.2.0.txt` (4 vCPU runner): 38 of 41 packages changed, 6214 pages, 133.6 s total.
   - fetch: 71.8 s (54%)
   - apply: 57.9 s (43%), of which relink is 41.1 s (31%)
   - index: 3.3 s (2.5%)
   - resolve: 0.6 s
4. **"Startup" is the wrong frame.** Startup (process start, manifest, lock) is under 1 s of a roughly 2 minute run. I'm treating the request as "make `docsync sync` faster" and flagging this in the report.

## Checkpoint (plan, not yet done)

### Step 1: build a representative fixture (new, under `bench/`)

- A generator script, kept outside the fixture dir, that writes N synthetic package archives (`.tar.gz` of `<Symbol>.json` files with `name`, `kind`, `doc` and `related`). Defaults: 38 packages, about 6200 symbols total, and `related` refs that cross package boundaries so relink does real rewriting.
- Generation is deterministic (seeded, fixed mtimes, no gzip timestamp) so the fixture is reproducible.
- A manifest listing them. `fetch` only checks the cache by file name `<sha256>.tar.gz` before it touches the network, so the cache is seeded as `$HOME/<UserCacheDir>/docsync/<sha>.tar.gz`. The `sha256` field is just the name to use. Cache hits don't verify the digest.
- An empty or absent lock, so all packages count as changed.
- Keep the existing no-op case as a second, labelled benchmark (`noop`). It is the "between releases" path and worth guarding against regressions.

### Step 2: rewrite `bench/bench.sh`

- Build the binary, generate or reuse the fixture, then run hyperfine with `--prepare` that resets the tree copy, lock and temp `HOME` cache.
- Run once outside hyperfine and save the stderr phase timings.
- Write the tree hash for the correctness gate.
- Runs: `--warmup 1 --runs 10`. A single run should take seconds, not minutes, so I'll tune the package and symbol counts until the apply/relink share looks like CI (about 40% of the run).

### Step 3: baseline

Record in this file: machine, Go version, git SHA, hyperfine median, min and stddev, phase breakdown, and the reference tree hash. Check the phase proportions against the CI log. If relink doesn't come out around 30% of the run, fix the fixture before climbing.

### Step 4: first candidates (ordered by expected win on the measurable phases)

1. **relink: skip unchanged files.** It reads and rewrites every `.md` in the tree even if no link changed. Only write when `linked != data`, and skip files that have no `](@` at all (a cheap `bytes.Contains` before the regex). It also walks the tree twice, and the first walk could be filled in during apply instead.
2. **relink: parallelize the rewrite pass** with a bounded worker pool (`GOMAXPROCS`). The `where` map is read-only by then.
3. **apply: parallelize across packages.** Each package writes into its own directory, so it is independent. `relink` has to stay after all packages are applied.
4. **apply: reduce syscalls per page.** Cache `MkdirAll` per directory, wrap `os.Create` in a `bufio.Writer`, and reuse the `Symbol` and decoder.
5. **index: collect during apply or relink** instead of reopening every file. Gain is small (about 2.5%), so it goes last.
6. **fetch: download concurrently** (bounded, around 8). This is the biggest share of the real run (54%), but the harness can't measure it offline.

## Risks and open points

- **Fetch is unmeasured.** A cache-seeded bench can't see download time, which is over half of the CI run. Concurrent fetch (candidate 6) would have to be verified on correctness (digests, atomic rename, error propagation) and checked once by hand against a real or local HTTP server. I won't claim a number for it from this harness. A local `httptest`-style server serving the synthetic archives with a fixed latency could cover it later if wanted.
- **Synthetic fixture fidelity.** The real archive sizes, doc lengths and link density are unknown. The CI log gives only counts. If the real archives are available, use them in place of the synthetic ones.
- **Macro-benchmark noise on a laptop.** Disk cache and thermal state matter for write-heavy phases. Using tmpfs or a RAM disk isn't possible on macOS without extra setup, so I'll rely on warmups and the stddev threshold.
- **Behavior to preserve:** page content, link rewrite semantics (including unresolved `@Name` left as is, and last-writer-wins on duplicate base names in `where`, which parallelizing must not change), the lock contents, and error handling on partial failure.
- **Unverified:** I haven't built or run anything, and the `/performance:hill-climb` command wasn't available in this session. I did the task by hand from the arguments given.

## Log

| # | Candidate | Median | vs best | Hash OK | Kept |
|---|-----------|--------|---------|---------|------|
| 0 | baseline  | -      | -       | -       | -    |
