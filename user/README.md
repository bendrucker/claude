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
  - `herdr-agent-state.sh` - Written by `herdr integration install claude` and gitignored; only its `settings.json` hook entry is committed (rewritten to `$HOME` form). Reinstall after cloning or a herdr version bump to restore the script, then discard the installer's `settings.json` edits: it re-sorts the file and appends a duplicate absolute-path entry it can't recognize as already present.
