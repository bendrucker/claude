#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
cat > README.md <<'MD'
# claude

Session history is indexed into DuckDB on each Mac at `~/.local/share/claude-sessions/session.duckdb`.
MD
