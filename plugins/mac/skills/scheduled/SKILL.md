---
name: mac:scheduled
description: >
  Reconcile launchd agents for scheduled Claude Code runs, grouped by machine.
  Use via /mac:scheduled, /mac:scheduled setup, /mac:scheduled sync,
  /mac:scheduled list, /mac:scheduled status, or /mac:scheduled run <label>.
argument-hint: "[setup | sync | list | status | run <label>] [dir...]"
disable-model-invocation: true
---

# Scheduled

Reconcile this machine's launchd agents against descriptor directories, committed in a repo (the `bendrucker/claude` checkout keeps them under `user/scheduled/<group>/`) or declared out-of-repo for a machine whose task set is proprietary. One YAML descriptor per task, one directory per machine group.

## Config

!`cat ~/.config/claude-scheduled/config.json 2>/dev/null || echo CONFIG_MISSING`

If the output above is `CONFIG_MISSING` and the requested mode is not `setup`, run [references/setup.md](references/setup.md) first, then continue into the requested mode.

## Mode

Requested mode: `$0`.

- `setup`: read [references/setup.md](references/setup.md)
- `sync`: read [references/sync.md](references/sync.md), which drives `bun ${CLAUDE_SKILL_DIR}/scripts/scheduled.ts sync [--dry-run] [dir...]`
- `list`: run `bun ${CLAUDE_SKILL_DIR}/scripts/scheduled.ts list [dir...]` and show the table (declared vs. installed, no launchd query)
- `status`: run `bun ${CLAUDE_SKILL_DIR}/scripts/scheduled.ts status [dir...]` and show the table (adds launchd load state)
- `run <label>`: run `bun ${CLAUDE_SKILL_DIR}/scripts/scheduled.ts run <label>` to kickstart an installed agent immediately, without waiting for its schedule
- no argument: default to `status`

Trailing arguments beyond the mode ($ARGUMENTS) pass through as `dir...` (group directories to scope the command to) or the label for `run`. Omitting directories reads every group from the config above.

## Model

Each group is a directory of YAML descriptors, one task per file with fields `label`, `schedule`, `mode`, `command`, and an optional `workdir`, documented in [references/descriptor.md](references/descriptor.md). The directory name is the group. A machine's config declares which groups it manages by absolute path, in-repo (committed, such as `~/src/bendrucker/claude/user/scheduled/<group>`) or out-of-repo (`~/.config/claude-scheduled/<group>`, for a proprietary task set).

`sync` renders every `headless` descriptor to a launchd plist, installs anything new or changed, and prunes any `me.bendrucker.claude.<group>.*` agent no longer declared. The label prefix scopes every install and prune, so a group's sync never touches another group's agents or an unrelated `com.user.*` one.

## Gotchas

- Plists are copied into `~/Library/LaunchAgents`, never symlinked. macOS 14+ ignores symlinked agents at login.
- `sync` without `--dry-run` writes outside the repo and calls `launchctl bootstrap`, registering a login-persistent agent. That trips the session's persistence guard by design. See [references/sync.md](references/sync.md) for the confirm-first flow.
- Descriptors never ship with this plugin. The config points at their directories, so the skill works from the plugin cache on any machine.
