#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../repo.sh"
mkdir -p "$HOME/tmp"
cat > "$HOME/tmp/mr-12-reply.md" <<'MD'
The cap keeps a long outage from pushing a single request past the 60 second gateway timeout.
Two retries at the cap still fit, and anything slower gets reported as a failure instead.
MD
