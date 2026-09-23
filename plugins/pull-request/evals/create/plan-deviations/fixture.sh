#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/agent-skills.git
mkdir -p skills/deploy
cat > skills/deploy/SKILL.md <<'MD'
---
name: deploy
description: Deploy the current branch to staging or production.
allowed-tools:
  - "Bash(fly deploy:*)"
---

# Deploy

Run `fly deploy` against the app named in `fly.toml`. Pass `--remote-only` in `quick` mode and add a health check in `careful` mode.
MD
git add -A && git commit -qm "deploy: add deploy skill"
git switch -qc deploy-status
cat > skills/deploy/SKILL.md <<'MD'
---
name: deploy
description: Deploy the current branch to staging or production.
allowed-tools:
  - "Bash(fly deploy:*)"
  - "Bash(fly status:*)"
---

# Deploy

Run `fly deploy` against the app named in `fly.toml`. Pass `--remote-only` in `fast` mode and add a health check in `verified` mode.

After deploying, run `fly status` and report the running machine count.
MD
git commit -qam "deploy: report machine status after deploy"
