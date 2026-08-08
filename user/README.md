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
  - `herdr-agent-state.sh` - Reports session state to herdr, vendored from `herdr integration install claude`

## Vendored Hooks

`hooks/herdr-agent-state.sh` originates from herdr's integration installer, which writes it to `~/.claude/hooks/`. Because that path is this directory through the symlink, the installed copy and the committed copy are the same file, and the committed copy is what every machine gets.

Keep it byte-identical to what the installer writes, header comments included. herdr owns the contents and bumps `HERDR_INTEGRATION_VERSION` when it changes them, so a herdr upgrade means rerunning `herdr integration install claude` and committing the resulting diff. Discard the installer's `settings.json` edits when you do: it cannot recognize the committed `$HOME`-form hook entry as its own, so it re-sorts the file and appends a duplicate absolute-path entry.

`bun scripts/check-hook-paths.ts` fails if a hook command in either settings file points at a `~/.claude/` or `$CLAUDE_PROJECT_DIR/` path this repo does not ship, which is what catches a vendored script going missing or a hook path outliving the script it named.
