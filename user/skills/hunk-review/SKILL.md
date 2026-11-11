---
name: hunk-review
description: Drive Ben's open Hunk diff session from the CLI to walk him through a change, navigate files and hunks, and leave or read inline notes. Use when he asks to review, explain, or annotate changes in Hunk, or names his open Hunk session.
allowed-tools:
  - Bash(hunk session:*)
  - Bash(hunk skill:*)
---

# Hunk Review

Ben launches the Hunk window. Drive it with `hunk session` commands and never start the interactive TUI. The instructions below come from the installed Hunk binary and match its version. Pass `--repo` the root of the repository the Hunk window opened, since a subdirectory or other worktree doesn't match its session.

!`hunk skill show hunk-review 2>&1 || echo "hunk is not installed. Tell Ben it comes from the dotfiles hunk topic."`
