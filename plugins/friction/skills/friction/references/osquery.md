# osquery Source

osqueryd's snapshot log is the main source for contention. The loader expects the scheduled queries in the table below, by name and columns.

`collect.sh osquery` (see SKILL.md's Collect step) loads `osqueryd.snapshots.log*` from the `osquery_dir` option (default `~/.local/state/osquery`) (rotated files are zstd and load with the live one), keeps the window, and runs each file in [`queries/osquery/`](../queries/osquery/). Times bucket by local day. CPU ticks and bytes are cumulative, so the loader takes deltas per process, per name, or for the host before filtering.

| Snapshot | Interval | What it records |
| --- | --- | --- |
| `pressure` | 10 s | Memory pressure level, available %, swap, `load1`, logical `cores` |
| `procs` | 60 s | Processes above 64 MB footprint, 60 s CPU, or 256 MB written |
| `host_cpu` | 10 s | Cumulative `user`, `nice`, `system`, and `idle` ticks summed over cores |
| `proc_groups` | 10 s | Per-name process count, thread total, cumulative CPU |
| `proc_tags` | 30 s | Optional. Session and pane tags per pid, in `osqueryd.results.log*` |

## Reading the Queries

- `saturation` counts minutes whose samples average under 10% of CPU ticks idle, and `min_idle_pct` is the lowest minute's average. `attribution` and `thread-hogs` use the same minutes. `load1` is not a symptom: on macOS it spikes without any rise in threads or CPU.
- `thread-hogs` names the groups using the CPU during saturated minutes. It reads `proc_groups`, which catches compilers and test workers that exit between `procs` samples. It is empty on a machine whose config predates `proc_groups`. Report saturation there as unattributed rather than guessing a cause.
- `write-rate` returns the 3 names with the highest one-minute writes each day, from per-process deltas in `procs`, and `heavy_mins` counts their minutes over 4 GiB. Only a name with `heavy_mins` above 0 is a finding. `proc_groups` totals jump as members come and go, so they can't give a rate.
- osquery reports -1 threads for a process it can't read, so `thread-hogs` undercounts names owned by other users.
- `heavy-writers` returns the `cwd`. Name the target by what the process was doing (a session-index refresh, a bench run), never by the path.
- `memory`: `lvl` is macOS's memory pressure level, where 2 is warn and 4 is critical. Record a finding only for a stretch at 2 or above longer than a minute.
- `load-thresholds` suggests the `load` mod's `remind`, `warn`, and `refuse` from how idle the CPU was at each load per core. Compare them on the weekly window with the `load@bendrucker` options in `user/settings.json`. A suggestion a full step or more from the setting is a finding. A NULL suggestion means the window never reached that load, so it says nothing about the setting, except that `refuse` belongs at `0` while every weekly run leaves it NULL. It is empty on a machine whose `pressure` query predates `cores`.
- Read `load-thresholds` beside the session index's `mods` rows for `load.cap.deny`. Agent priority is deferred until refusals hold real work, so a week with 60 or more denies is a `contention` finding on `load holds`.
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
| `load-thresholds`, a suggestion a step or more from the setting | `config-drift` | `load thresholds` |
| `mods`, 60 or more `load.cap.deny` in a week | `contention` | `load holds` |
