# `performance:profile` samply Eval

A native `claude plugin eval` suite for how a session uses samply through `performance:profile`: getting a usable profile on the first attempt, attributing time to the right frame, turning a share into a bound on the gain, and not reading noise or idle threads as hotspots. Every case hands the session `/performance:profile` and a small C program its fixture builds, whose profile holds a known finding. The session records and reads real profiles. A case costs one profiling session. Cases are tagged by kind (`attribution`, `setup`, `noise`, `batch`) and split (`dev`, `holdout`).

## Cases

| Case | Split | Program | Planted finding |
| --- | --- | --- | --- |
| `two-callers` | dev | `logidx` | `hash_key` is 95% of self time, reached through `is_reserved` (about 78%, four salted hashes per line) and `index_insert` (about 18%). The fix is in the caller, bounded at about 78%. |
| `lock-contention` | dev | `ingest` | Eight workers queue on one mutex in `stats_record`. `__psynch_mutexwait` counts as CPU on macOS (about 74%), and the work done under the lock is `percentile_refresh`. `score_item` (about 11%) is the trap. |
| `idle-pool` | dev | `thumbs` | `decode_block` is about 90% of CPU on the main thread while six pool workers and a flusher sit idle. Their waits are not costs. |
| `hardened` | dev | vendored `tilecut` | The binary carries the hardened runtime, so samply fails with "Could not obtain the root task" until a copy is re-signed ad hoc. `rle_encode` is about 75%, `crc_tile` about 25%. |
| `short-run` | dev | `tokcount` | One run lasts about 4 ms, a handful of samples that rank at random. Pooled with `--iteration-count`, `tokenize` is about 64% of self time and `classify` about 35% inclusive. |
| `multi-case` | dev | `csvq` | Four benchmark cases, each with its own lead: `parse_amount` (`strtod`), `group_lookup`, `compare_rows` (inclusive, its self time spread over libc), `seen_insert` (`memmove`). |
| `copy-split` | dev | `framer` | `_platform_memmove` is the top self frame. `compact_log`'s shift reaches it for about 40 to 45% of the run, while `compact_log` is about 63% inclusive. A fix to the shift is bounded by the smaller share. |
| `two-locks` | dev | `relayd` | Workers wait on two mutexes. The cache lock in `cache_get`, held for a few instructions on every event, takes about 57% of samples waiting. The journal lock, whose critical section scans the journal, takes about 10%. |
| `quadratic` | holdout | `jobq` | `_platform_memmove` is about 77%, all under `queue_pop`'s pop-front shift, which bounds a fix at about 4.3x. |
| `stripped` | holdout | `blend` | The release build is stripped, so frames read `fun_8d4`. At `-O2` `tone_map` is about 83%, and at `-O0` (`make debug`) `mix_rows` ranks first instead. |

Each case's graders hold its expected finding. `samply`, shared through `suite.yaml`, checks that the session recorded with samply. `first-try` graders on `hardened` and `short-run` check that the session's first recording was usable, rather than a failure or a few samples it then had to redo.

## samply Relay

A Bash grant puts every session command under the OS sandbox, where samply fails with `Unknown(1100)`. Each fixture runs [`relay/install.sh`](relay/install.sh) after `git init`. It puts a `samply` stub first on the session's PATH and starts [`relay/daemon.ts`](relay/daemon.ts) outside the sandbox, which runs the stub's `samply record` requests with real samply when their working directory is inside the run's temp directory. The daemon exits when the run's directory goes away, or after 30 minutes.

## Running

Unset `CLAUDE_CODE_SHELL_PREFIX` before running from a Claude Code session, since the sessions inherit it and the sandbox cannot read the prefix script, which fails the skill's `!` injections before the first turn.

`env -u CLAUDE_CODE_SHELL_PREFIX bun evals/native/run.ts plugins/performance/evals/profile --ref <ref> -- --tag dev --runs 4` runs the plugin at `<ref>` against a no-plugin baseline. Pass `--ablation none` after `--` to skip the baseline. The suite is `.local-only`, since CI runners lack the relay's unsandboxed samply.

- `bun evals/native/compare.ts --suite plugins/performance/evals/profile <base>/aggregate-result.json <candidate>/aggregate-result.json` compares two runs by case and tag.
- `bun evals/native/check.ts plugins/performance/evals/profile` tests the regex graders against [`examples/`](examples/).
