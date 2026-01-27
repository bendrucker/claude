# User Configuration

This directory contains user-level Claude Code configuration, symlinked to `~/.claude/`.

Run `install.sh` to create the symlinks.

## Contents

- `CLAUDE.md` - Global instructions that apply to all projects
- `settings.json` - User settings (plugins, permissions, sandbox, hooks)
- `hooks/` - User-level hooks that run across all projects
  - `worktree/` - Validates bash commands in worktrunk worktrees
  - `claude-island-state.py` - Claude Island integration
