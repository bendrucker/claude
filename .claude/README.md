# Project Configuration

This directory contains project-level Claude Code configuration for this repository.

## Contents

- `settings.json` - Project-specific settings (lint and commit-gate hooks)
- `settings.local.json` - Local overrides (not committed)
- `hooks/ox/` - Lints each edited file and reports issues as context
- `hooks/stop/` - Runs prek over the files a turn edited before the session stops
- `rules/` - Path-gated guidance that auto-injects when matching files are edited (via `paths` frontmatter)
