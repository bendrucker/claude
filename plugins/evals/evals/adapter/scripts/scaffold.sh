#!/usr/bin/env bash
# Usage: scaffold.sh <framework> <interface|guide>, run from the session's working directory.
set -euo pipefail
suite="$(cd "$(dirname "$0")/.." && pwd)"
mkdir evals
rsync -a --exclude '*.test.ts' --exclude __snapshots__ "$suite/../../../../packages/evals/" evals/
if [ "$2" = guide ]; then
  cp "$suite/../../skills/hill-climb/references/harnesses.md" harnesses.md
fi
