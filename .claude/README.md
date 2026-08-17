# Project Configuration

This directory contains project-level Claude Code configuration for this repository.

## Contents

- `settings.json` - Project-specific settings (ox lint hook)
- `settings.local.json` - Local overrides (not committed)
- `hooks/ox/` - Runs oxlint/oxfmt after file edits
- `rules/` - Path-gated guidance that auto-injects when matching files are edited (via `paths` frontmatter)
