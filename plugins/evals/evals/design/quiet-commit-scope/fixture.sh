#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/commits/.claude-plugin plugins/commits/skills/commit-scope
cat > plugins/commits/.claude-plugin/plugin.json <<'JSON'
{
  "name": "commits",
  "description": "Commit message helpers"
}
JSON
cat > plugins/commits/skills/commit-scope/SKILL.md <<'MD'
---
name: commit-scope
description: Pick the conventional-commit scope for a change. Use when asked which scope a commit should have, or to fix the scope of an existing commit subject.
---

# Commit Scope

Reply with the full subject line, `type(scope): summary`, and nothing else.

- The scope is the top-level directory under `src/` that holds most of the changed lines: `src/api/routes.ts` gives `api`.
- A change that touches no `src/` file has no scope: `chore: bump node`.
- When fixing an existing subject, keep its type and summary and change only the scope.

This skill covers the subject line only. A commit body, a PR description, a rebase, and a squash are out of scope.
MD
