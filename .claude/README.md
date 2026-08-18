# Project Configuration

This directory contains project-level Claude Code configuration for this repository.

## Contents

- `settings.json` - Project-specific settings (oxlint/oxfmt hook)
- `settings.local.json` - Local overrides (not committed)
- `hooks/ox/` - Lints on edit, then formats and type-checks at Stop and commit
- `rules/` - Path-gated guidance that auto-injects when matching files are edited (via `paths` frontmatter)
