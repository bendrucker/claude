# Session Index Benchmark

Measures the session index on the work agents wait through: the queries they run most, replayed in fresh read-only `duckdb` processes, and the incremental refresh after a transcript changes. It is the harness for `performance:hill-climb` on the index and follows `performance:benchmark`: arms interleave, every sample is kept, and each group also lands as a hyperfine export that `compare.ts report` pools.

## Metrics

| Column | Source |
|---|---|
| wall | process start to exit, what an agent's Bash call waits |
| engine | the profile's `latency` for the last statement |
| MB read, rows scanned | the profile's `total_bytes_read` and `cumulative_rows_scanned` |
| buffer MB | the profile's `system_peak_buffer_memory` |
| RSS MB | the process's peak resident memory |
| index MB | the index file's size |
| OOM, failed | runs that ran out of memory, and runs that errored, timed out, or exited non-zero |

A change against the base is starred when its permutation p is below 0.1 and it clears the noise floor: 2σ of the base's runs or 10% of its median, whichever is larger.

## Limits

`mac` runs under the skill's `limits.sql` (4 GiB, 4 threads). `vm` appends the cloud VM readers' cap (450 MB, 1 thread). Named queries that read Markdown or YAML from disk load `extensions.sql` instead.

## Workflow

Never point the harness at the live index. Freeze a copy first. The index under test then does not move between runs. On APFS the clone is instant and shares blocks:

```bash
cp -c ~/.local/share/claude-sessions/session.duckdb /tmp/frozen.duckdb
```

Mine the replay set from it. It keeps every query group that ran out of memory, the top group for each hot view and named query, then the most frequent groups up to `--top`. Named queries that read a file relative to the caller's cwd are left out, because a replay runs from no project:

```bash
bun bench.ts replay-set --db /tmp/frozen.duckdb
```

`replay.json`, `snap/` and `results/` hold SQL and transcripts agents wrote. They stay out of git and live in the eval bucket. The eval suite's [`sync.ts`](../session/scripts/sync.ts) mirrors them with its own data, `push` after a run and `pull` before one.

### Arms

A storage change rewrites the index. Every arm is built by its own `refresh.ts` from one JSONL snapshot. `snapshot` writes the index's local transcripts back out from `raw.data`, sampling whole sessions within each month up to `--mb`, so a machine without `~/.claude/projects` can still build arms:

```bash
bun bench.ts snapshot --db /tmp/frozen.duckdb --out snap --mb 1200
bun bench.ts build --snapshot snap --out arms/main
bun bench.ts build --snapshot snap --out arms/aa
bun bench.ts build --snapshot snap --out arms/zstd --skill ../wt/plugins/observability/skills/session
```

`build` records its wall time, peak RSS and index size in `build.json`. `run` and `refresh` refuse an arm whose index was last built by a different `views.sql` than its skill dir's, since its named queries would read another commit's views. A full build of the whole corpus is the number a storage PR claims; the sample is for climbing.

### Runs

Record the noise floor with an A/A run, two arms built from the same snapshot, then compare a candidate. An arm is `name=<index>[,<skill dir>]`; the skill dir defaults to this checkout's and supplies the named queries and limits. A candidate worktree thus replays its own:

```bash
bun bench.ts run --arm main=arms/main/session.duckdb --arm aa=arms/aa/session.duckdb --out results/aa
bun bench.ts run --arm main=arms/main/session.duckdb --arm zstd=arms/zstd/session.duckdb,../wt/plugins/observability/skills/session --out results/zstd
```

Two builds of one snapshot hold the same rows in a different physical order, because `content_items` is rebuilt by a parallel window. DuckDB samples its distinct-count statistics in that order, so cardinality estimates shift between builds. A query whose join order hinges on them shows up as an A/A difference past the noise floor. That is a fragile plan in the query or view, not a storage effect: fix its shape, as `sandbox_bypasses` materializes its failure set, rather than averaging builds.

Pass `--limits vm` to climb at the cloud readers' cap alone, and `--prepare 'sync && sudo purge'` for cold-cache runs on macOS.

Time the refresh per changed transcript. Each run starts from a clone of the arm's index with real transcripts of the target size staged under a throwaway import host. The frozen index stays untouched:

```bash
bun bench.ts refresh --arm main=arms/main/session.duckdb --out results/refresh
```

`--rows` defaults to the corpus's median and p90 transcript sizes. `report <dir>` reprints a results directory, and `results/` stays out of git.

## Tests

```bash
bun test ./plugins/observability/evals/bench/
bun test ./plugins/observability/evals/bench/bench.integration.ts
```
