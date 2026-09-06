# User Configuration

This directory contains user-level Claude Code configuration, symlinked to `~/.claude/`.

Run `scripts/install.sh` to create the symlinks.

## Contents

- `CLAUDE.md` - Global instructions that apply to all projects
- `settings.json` - User settings (plugins, permissions, sandbox, hooks)
- `hooks/` - User-level hooks that run across all projects
  - `worktree/` - Validates bash commands in worktrunk worktrees
  - `webfetch-block/` - Steers WebFetch calls toward better tools
  - `session-limit/` - Warns when a session approaches its limit
  - `permission-denied/` - Logs auto mode classifier denials so the `autoMode` rules stay measurable
  - `herdr-agent-state.sh` - Reports session identity to herdr. Written by `herdr integration install claude`, gitignored here

## Vendored Hooks

`hooks/herdr-agent-state.sh` is herdr's file. Its installer writes it to `~/.claude/hooks/`, which is this directory through the symlink, and bumps `HERDR_INTEGRATION_VERSION` inside it when the contents change. The path is gitignored so the installer's write never dirties the deployed clone, and the nightly `claude-upgrade` in dotfiles reruns the installer after each sync, so the deployed copy always matches the installed herdr. A fresh clone has no script until that runs.

The `SessionStart` entry that runs it is committed in `settings.json` in `$HOME` form. herdr's installer matches its own entry by exact command string, so it cannot recognize that form and appends a duplicate absolute-path entry on every install. `claude-upgrade` discards that edit. herdr's status check reads only the script's version marker, so the discarded edit costs nothing.

`bun scripts/check-hook-paths.ts` fails if a hook command in either settings file points at a `~/.claude/` or `$CLAUDE_PROJECT_DIR/` path this repo does not ship, which is what catches a hook path outliving the script it named. The herdr script is exempt, since its installer is what ships it.
