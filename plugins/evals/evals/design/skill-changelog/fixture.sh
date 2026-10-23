#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/notes/.claude-plugin plugins/notes/skills/changelog-entry
cat > plugins/notes/.claude-plugin/plugin.json <<'JSON'
{
  "name": "notes",
  "description": "Changelog helpers"
}
JSON
cat > plugins/notes/skills/changelog-entry/SKILL.md <<'MD'
---
name: changelog-entry
description: Write one changelog entry for a change. Use when asked to add a changelog line, entry, or note for a fix, feature, or breaking change.
---

# Changelog Entry

Write one line for `CHANGELOG.md` under `## Unreleased`, in the section that matches the change: `### Fixed`, `### Added`, or `### Changed`.

- Start with an imperative verb: "Retry", not "Retried" or "Fixed a bug where we retried".
- Keep the line under 72 characters and leave out PR numbers and author names.
- Start a breaking change with `BREAKING:` and put it in `### Changed`, whatever else it does.
- Name the user-visible effect, not the code that changed.
MD
cat > CHANGELOG.md <<'MD'
# Changelog

## Unreleased

### Added

- Export reports as CSV.

### Fixed

- Keep the cursor position after a failed save.
MD
