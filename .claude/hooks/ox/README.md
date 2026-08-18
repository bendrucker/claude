# Ox Hook

Runs [oxlint](https://oxc.rs/docs/guide/usage/linter.html) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) on edited files with a two-phase approach that balances immediate feedback with uninterrupted workflow.

## How It Works

#### During Work (PostToolUse)

When you `Edit` or `Write` a file oxlint understands, it runs and shows any issues as context. This is informational only. It never writes to the file, so your later edits in the same turn still match what is on disk. Formatting is deferred to the Stop and pre-commit gates.

#### Before Stopping (Stop)

When the session ends, oxfmt formats all edited files, oxlint checks them, and a repo-wide type check runs (`oxlint --type-aware --type-check`). If issues remain, the session is blocked until they're resolved.

This lets you stay in flow during development while ensuring code quality before completing work.

## Pre-Commit Check

The hook also runs on `git commit`, formatting and checking staged files (plus the repo-wide type check) and blocking commits with remaining lint or type errors. Nothing is auto-fixed beyond formatting, so a lint error blocks whether or not a fixer exists for it.

## Degraded Runs

Only oxlint is required. When oxfmt cannot be resolved, the gates still lint and type-check and simply skip reformatting, rather than passing silently.
