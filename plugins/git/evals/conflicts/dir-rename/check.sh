#!/usr/bin/env bash
set -euo pipefail
test ! -e plugins/claude-code && git cat-file -e HEAD:plugins/observability/skills/session/scripts/retention.ts
