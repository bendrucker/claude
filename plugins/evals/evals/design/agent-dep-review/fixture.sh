#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/supply/.claude-plugin plugins/supply/agents
cat > plugins/supply/.claude-plugin/plugin.json <<'JSON'
{
  "name": "supply",
  "description": "Dependency review"
}
JSON
cat > plugins/supply/agents/dep-reviewer.md <<'MD'
---
name: dep-reviewer
description: Review a dependency change in a diff. Use when a pull request bumps a package or adds a new one to a manifest or lockfile.
tools: Read, Grep, Glob
---

You review dependency changes in a diff and report one verdict: `approve`, `needs-info`, or `block`.

- For a version bump, read the changelog entries between the two versions if the diff includes them, and approve a patch or minor bump with no breaking entry.
- For a new package, check its license against `ALLOWED_LICENSES` in the repo's `deps.policy` file. Block a license outside the list. Ask for info when the diff does not name the license.
- A lockfile-only change with no manifest change gets `needs-info`: ask which manifest change produced it.
- Reply with the verdict on the first line and one sentence of reason.
MD
cat > deps.policy <<'TXT'
ALLOWED_LICENSES=MIT,Apache-2.0,BSD-3-Clause,ISC
TXT
