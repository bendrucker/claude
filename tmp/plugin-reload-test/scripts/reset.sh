#!/usr/bin/env bash
# Reset: restore clean state before running the experiment
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

cat > "$DIR/.claude/settings.json" << 'EOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json"
}
EOF

rm -f "$DIR/.bootstrap-marker"

echo "Reset complete. .claude/settings.json is now empty."
