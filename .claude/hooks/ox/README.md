# Ox Hook

Runs [oxlint](https://oxc.rs/docs/guide/usage/linter.html) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) on edited files with a two-phase approach that balances immediate feedback with uninterrupted workflow.

## How It Works

**During work (PostToolUse)**: When you edit a file, oxlint runs and shows any issues as context. This is informational only, and never writes to the file, so mid-turn edits keep applying cleanly. Formatting deviations are left alone until Stop.

**Before stopping (Stop)**: When the session ends, oxfmt formats all edited files and oxlint checks them, along with a repo-wide type check (`oxlint --type-aware --type-check`). If issues remain, the session is blocked until they're resolved.

This lets you stay in flow during development while ensuring code quality before completing work.

## Pre-Commit Check

The hook also runs on `git commit`, formatting and checking staged files (plus the repo-wide type check) and blocking commits with unfixable issues.
