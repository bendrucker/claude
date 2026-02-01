# Biome Hook

Runs [Biome](https://biomejs.dev/) checks on edited files with a two-phase approach that balances immediate feedback with uninterrupted workflow.

## How It Works

**During work (PostToolUse)**: When you edit a file, Biome runs and shows any issues as context. This is informational only—Claude can keep working without stopping to fix every issue immediately.

**Before stopping (Stop)**: When the session ends, Biome runs on all edited files. It auto-fixes what it can. If unfixable issues remain, the session is blocked until they're resolved.

This lets you stay in flow during development while ensuring code quality before completing work.

## Pre-commit Check

The hook also runs on `git commit`, checking staged files and blocking commits with unfixable Biome errors.
