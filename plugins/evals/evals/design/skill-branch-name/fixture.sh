#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/gitflow/.claude-plugin plugins/gitflow/skills/branch-name
cat > plugins/gitflow/.claude-plugin/plugin.json <<'JSON'
{
  "name": "gitflow",
  "description": "Branch and tag helpers"
}
JSON
cat > plugins/gitflow/skills/branch-name/SKILL.md <<'MD'
---
name: branch-name
description: Name a git branch for a piece of work. Use when asked what to call a branch or to name a new topic branch.
---

# Branch Name

Reply with one branch name and nothing else.

- With a ticket key (`PLAT-123`), use `<key lowercased>-<slug>`: `plat-123-retry-uploads`.
- Without one, use `<verb>-<slug>`: `fix-retry-uploads`.
- The slug is at most four words, lowercase, joined by hyphens.
- Never put a slash, a username, or a date in the name.
MD
