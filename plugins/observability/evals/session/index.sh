#!/usr/bin/env bash
# Copies the frozen index to where the skill looks by default, under the run's temporary home.
# A refresh stamp dated ahead of the run makes refresh.ts read the copy as current, so a session
# never rescans or rewrites it.
set -euo pipefail
suite="$(cd "$(dirname "$0")" && pwd)"
dir="$HOME/.local/share/claude-sessions"
mkdir -p "$dir"
# An APFS clone is instant; elsewhere it falls back to a full copy.
cp -c "$suite/data/session.duckdb" "$dir/" 2>/dev/null || cp "$suite/data/session.duckdb" "$dir/"
touch -t 203001010000 "$dir/last-refresh"
