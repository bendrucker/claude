#!/usr/bin/env bash
set -euo pipefail

# Renovate bumps this pin (renovate.json5).
CLAUDE_CODE_VERSION=2.1.300

curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_CODE_VERSION"
