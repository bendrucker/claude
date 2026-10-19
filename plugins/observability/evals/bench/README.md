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

Freeze a snapshot first, so the index under test does not move between runs. On APFS the clone is instant and shares blocks:

```bash
cp -c ~/.local/share/claude-sessions/session.duckdb /tmp/frozen.duckdb
```

Mine the replay set from it. It keeps every query group that ran out of memory, the top group for each hot view and named query, then the most frequent groups up to `--top`:

```bash
bun bench.ts replay-set --db /tmp/frozen.duckdb
```

`replay.json` holds SQL agents wrote, so it stays out of git and lives in the eval bucket:

```bash
aws s3 cp replay.json s3://ben-drucker-agents-eval-corpus/session/bench/replay.json --profile agents-admin
aws s3 cp s3://ben-drucker-agents-eval-corpus/session/bench/replay.json replay.json --profile agents
```

Record the noise floor with an A/A run, two arms on the same index, then compare a candidate. An arm is `name=<index>[,<skill dir>]`; the skill dir defaults to this checkout's and supplies the named queries and limits, so a candidate worktree replays its own:

```bash
bun bench.ts run --arm main=/tmp/frozen.duckdb --arm aa=/tmp/frozen.duckdb --out results/aa
bun bench.ts run --arm main=/tmp/frozen.duckdb --arm zstd=/tmp/zstd.duckdb,../wt/plugins/observability/skills/session --out results/zstd
```

Build a candidate index from the same JSONL snapshot as the base, since a storage change rewrites the file. Pass `--prepare 'sync && sudo purge'` for cold-cache runs on macOS.

Time the refresh per changed transcript. Each run starts from a clone of the arm's index with real transcripts of the target size staged under a throwaway import host, so the live transcripts and the frozen index stay untouched:

```bash
bun bench.ts refresh --arm main=/tmp/frozen.duckdb --out results/refresh
```

`--rows` defaults to the corpus's median and p90 transcript sizes. `report <dir>` reprints a results directory, and `results/` stays out of git.

## Tests

```bash
bun test ./plugins/observability/evals/bench/
bun test ./plugins/observability/evals/bench/bench.integration.ts
```
