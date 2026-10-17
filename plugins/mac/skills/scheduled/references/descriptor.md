# Descriptor

One YAML file per task in a group directory.

```yaml
label: discover                 # -> me.bendrucker.claude.<group>.<label>
schedule: { weekday: mon, at: "07:23" }
mode: headless                  # headless now; agent-view | cloud reserved
command: /improve-claude-code discover --scheduled
workdir: ~/src/bendrucker/claude # optional; expanded per-machine
```

`schedule` takes `at` (`HH:MM`) plus an optional `weekday` (`sun`..`sat`) or `day` (day of month). `permission_mode` defaults to `acceptEdits`. Logs default to `~/Library/Logs/claude-<group>-<label>.{log,err.log}`.

## `mode`

- `headless`: the only backend today. Runs `claude -p "<command>" --permission-mode <permission_mode>` under a launchd `StartCalendarInterval`.
- `agent-view`: reserved for a run that opens in an attended agent view instead of headless `-p`. Not built.
- `cloud`: reserved for a non-launchd backend, so one descriptor format can represent a routine whether it runs locally or in the cloud. Not built.

Placement: local (`headless`/`agent-view`) fits a task tied to this machine, such as a local database, a CLI only installed here, or on-disk session history. Cloud fits a task with no such dependency.
