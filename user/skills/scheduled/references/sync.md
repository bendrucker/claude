# Sync

`sync` reconciles the managed groups' descriptor directories against this machine's installed launchd agents.

## Always Dry-Run First

Run `bun user/skills/scheduled/scripts/scheduled.ts sync --dry-run [dir...]` (every managed group from the config when no directories are given) and present the printed install/update/prune table before doing anything else. `--dry-run` touches no launchctl and writes no files, so it is always safe to run first, and to re-run after every descriptor edit.

## Confirm, Then Install

Installing (`sync` without `--dry-run`) copies plists into `~/Library/LaunchAgents` and runs `launchctl bootstrap`/`bootout`, registering a login-persistent agent. That is a deliberate action outside the repo, so it trips the session's persistence guard by design. Confirm the dry-run plan with the user before dropping `--dry-run`.

## What It Does

For each managed group directory:

- Renders every `mode: headless` descriptor to a plist. Descriptors with `mode: agent-view` or `mode: cloud` are reserved and get skipped, logged as such.
- Diffs desired labels against installed `me.bendrucker.claude.<group>.*` agents, scoped so a group's sync only ever touches its own agents.
- Installs anything new, re-installs anything whose rendered plist content changed, and prunes (`bootout` plus delete) anything installed but no longer declared.

## Verify

`/scheduled status` shows load state per agent (`launchctl print`). `/scheduled run <label>` (`<group>.<label>` or the full launchd label) kickstarts an agent immediately, without waiting for its schedule, to confirm a newly-installed agent actually fires.
