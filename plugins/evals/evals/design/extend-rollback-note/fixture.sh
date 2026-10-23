#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/ops/.claude-plugin plugins/ops/skills/rollback-note
cat > plugins/ops/.claude-plugin/plugin.json <<'JSON'
{
  "name": "ops",
  "description": "Operations helpers"
}
JSON
cat > plugins/ops/skills/rollback-note/SKILL.md <<'MD'
---
name: rollback-note
description: Write the incident-channel note for a rollback. Use when asked to announce a rollback or a hotfix deploy.
---

# Rollback Note

Reply with a three-line note: `What:`, `Impact:`, and `Next:`.

- `What:` names the service and the version rolled back to, or the hotfix version deployed.
- `Impact:` states who is affected and since when, in plain words.
- `Next:` gives one action and its owner.
- A hotfix note also names the commit that carries the fix.
MD
suite=plugins/ops/evals/rollback-note
mkdir -p "$suite"
cat > "$suite/suite.yaml" <<'YAML'
allow_tools: []
YAML
add_case() {
  name=$1
  kind=$2
  request=$3
  mkdir -p "$suite/$name/graders"
  cat > "$suite/$name/case.yaml" <<YAML
schema_version: "1.1"
name: $name
tags: [dev, $kind]
plugins: ["../../.."]
execution:
  model: claude-sonnet-5-5
  max_turns: 4
  timeout_seconds: 300
  allowed_tools: [Skill]
YAML
  printf '%s\n' "$request" > "$suite/$name/prompt.md"
  cat > "$suite/$name/graders/three-lines.md" <<'MD'
---
type: regex
target: last_message
pattern: '^What:.*\n+Impact:.*\n+Next:'
match: contains
---
The reply has the three labeled lines.
MD
}
add_case rollback-billing rollback "Announce that we rolled billing-api back to 4.12.1."
add_case rollback-search rollback "Write the note: search-svc is back on 2.9.0 after the index change."
add_case hotfix-auth hotfix "Announce the hotfix deploy of auth-svc 3.4.1, commit 9f2c1ab."
add_case hotfix-cron hotfix "Hotfix note: scheduler 1.8.2 is live, fix is commit 31bd07e."
