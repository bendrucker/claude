# Scheduled Tasks

Repo-local, machine-grouped descriptors for launchd agents, reconciled by the [`scheduled`](../skills/scheduled/) skill.

## Groups

A group is a directory of YAML descriptors, one task per file. The directory name is the group and scopes the launchd label (`me.bendrucker.claude.<group>.<label>`), so `/scheduled sync` only ever installs, updates, or prunes agents within one group.

`home` (this directory) is committed and runs on the always-on Mac Studio. A work laptop manages its own group from `~/.config/claude-scheduled/<group>`, outside this repo, so proprietary task definitions never reach GitHub. Both kinds of group are declared the same way in a machine's `~/.config/claude-scheduled/config.json` (see the skill's setup reference), and `/scheduled sync` reconciles them identically regardless of where the directory lives.

## Descriptor

```yaml
label: discover                 # -> me.bendrucker.claude.<group>.<label>
schedule: { weekday: mon, at: "07:23" }
mode: headless                  # headless now; agent-view | cloud reserved
command: /improve-claude-code discover --scheduled
workdir: ~/src/bendrucker/claude # optional; expanded per-machine
```

`permission_mode` defaults to `acceptEdits`. Logs default to `~/Library/Logs/claude-<group>-<label>.{log,err.log}`.

## `mode`

- `headless`: the only backend today. Runs `claude -p "<command>" --permission-mode <permission_mode>` under a launchd `StartCalendarInterval`.
- `agent-view`: reserved for a scheduled run that opens in an attended agent view instead of headless `-p`. Not built.
- `cloud`: reserved for a task reconciled by a future non-launchd backend instead of this machine, so the same descriptor format can represent a routine whether it runs locally or in the cloud. Not built.

Placement: local (`headless`/`agent-view`) fits a task tied to this machine specifically, a local database, a CLI only installed here, session history that lives on disk. Cloud fits a task with no such dependency. That distinction, and the cloud backend itself, are out of scope here.
