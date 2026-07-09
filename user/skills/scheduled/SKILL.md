---
name: scheduled
description: >
  Reconcile repo-local launchd agents for scheduled Claude Code runs, grouped
  by machine. Use via /scheduled, /scheduled setup, /scheduled sync,
  /scheduled list, /scheduled status, or /scheduled run <label>.
argument-hint: "[setup | sync | list | status | run <label>] [dir...]"
disable-model-invocation: true
---

# Scheduled

Reconcile this machine's launchd agents against descriptor directories committed under `user/scheduled/<group>/`, or declared out-of-repo for a machine whose task set is proprietary. One YAML descriptor per task, one directory per machine group.

## Config

!`cat ~/.config/claude-scheduled/config.json 2>/dev/null || echo CONFIG_MISSING`

If the output above is `CONFIG_MISSING` and the requested mode is not `setup`, run [references/setup.md](references/setup.md) first, then continue into the requested mode.

## Mode

Requested mode: `$0`.

- `setup`: read [references/setup.md](references/setup.md)
- `sync`: read [references/sync.md](references/sync.md)
- `list`: run `bun user/skills/scheduled/scripts/scheduled.ts list [dir...]` and show the table (declared vs. installed, no launchd query)
- `status`: run `bun user/skills/scheduled/scripts/scheduled.ts status [dir...]` and show the table (adds launchd load state)
- `run <label>`: run `bun user/skills/scheduled/scripts/scheduled.ts run <label>` to kickstart an installed agent immediately, without waiting for its schedule
- no argument: default to `status`

Trailing arguments beyond the mode ($ARGUMENTS) pass through as `dir...` (group directories to scope the command to) or the label for `run`. Omitting directories reads every group from the config above.

## Model

Each group is a directory of YAML descriptors, one task per file: `label`, `schedule`, `mode` (only `headless` is backed today; `agent-view` and `cloud` are reserved, see [`user/scheduled/README.md`](../../scheduled/README.md)), `command`, and an optional `workdir`. The directory name is the group. A machine's config declares which group directories it manages: in-repo (`user/scheduled/<group>`, committed) or out-of-repo (`~/.config/claude-scheduled/<group>`, never committed) for a task set that must never reach the public repo.

`sync` renders every `headless` descriptor to a launchd plist, installs anything new or changed, and prunes any installed `me.bendrucker.claude.<group>.*` agent no longer declared. The group's label prefix scopes every install and prune, so a group's sync can never touch another group's agents or an unrelated agent like dotfiles' `com.user.*` ones.

## Gotchas

- Plists are copied into `~/Library/LaunchAgents`, never symlinked. macOS 14+ ignores symlinked agents at login.
- `sync` without `--dry-run` writes outside the repo and calls `launchctl bootstrap`, registering a login-persistent agent. That trips the session's persistence guard by design; see [references/sync.md](references/sync.md) for the confirm-first flow.
- `scripts/scheduled.ts` lives inside this skill directory rather than `packages/`, so it works wherever the skill is symlinked, including a machine without this repo checked out.
