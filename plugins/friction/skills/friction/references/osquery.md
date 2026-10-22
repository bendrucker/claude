# osquery Source

osqueryd's snapshot log is the main source for contention. The loader expects the scheduled queries in the table below, by name and columns.

`collect.sh osquery` (see SKILL.md's Collect step) loads `osqueryd.snapshots.log*` from the `osquery_dir` option (default `~/.local/state/osquery`) (rotated files are zstd and load with the live one), keeps the window, and runs each file in [`queries/osquery/`](../queries/osquery/). Times bucket by local day. CPU ticks and bytes are cumulative, so the loader takes deltas per process, per name, or for the host before filtering.

| Snapshot | Interval | What it records |
| --- | --- | --- |
| `pressure` | 10 s | Memory pressure level, available %, swap, `load1` |
| `procs` | 60 s | Processes above 64 MB footprint, 60 s CPU, or 256 MB written |
| `host_cpu` | 10 s | Cumulative `user`, `nice`, `system`, and `idle` ticks summed over cores |
| `proc_groups` | 10 s | Per-name process count, thread total, cumulative CPU and bytes written |
| `proc_tags` | 30 s | Optional. Session and pane tags per pid, in `osqueryd.results.log*` |

## Reading the Queries

- `saturation` counts minutes where every sample had under 5% of CPU ticks idle. `attribution` and `thread-hogs` use the same test. `load1` is not a symptom: on macOS it spikes without any rise in threads or CPU.
- `thread-hogs` names the groups using the CPU during saturated minutes. It is empty on a machine whose config predates `proc_groups`. Report saturation there as unattributed rather than guessing a cause.
- `write-rate` counts minutes in which one process name wrote over 1 GiB. A group's total drops when a member exits, and that interval counts as unknown.
- `heavy-writers` returns the `cwd`. Name the target by what the process was doing (a session-index refresh, a bench run), never by the path.
- `memory`: `lvl` is macOS's memory pressure level, where 2 is warn and 4 is critical. Record a finding only for a stretch at 2 or above longer than a minute.
- `background-cpu` needs 20 hours of one process, so it fires only on the weekly window. Record it at `low`.
- Only about a third of `bun`/`duckdb` pids carry a `proc_tags` session tag, so treat an untagged process as unknown, not as unrelated to Claude.

## Targets

The fingerprint is `type|target`, so each query names its symptom the same way every run.

| Query | Type | Target |
| --- | --- | --- |
| `attribution`, a suspect active in most saturated minutes | `contention` | the suspects, as written: `bun, duckdb` |
| `saturation`, no suspect or `thread-hogs` empty | `contention` | `CPU saturation` |
| `thread-hogs` | `contention` | the process name |
| `heavy-writers`, `write-rate` | `contention` | the activity from this list, else the process name: `session-index refresh`, `agent worktree build`, `benchmark run` |
| `memory` | `contention` | `memory pressure` |
| `background-cpu` | `contention` | the process name |
