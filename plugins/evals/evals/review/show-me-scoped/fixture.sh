#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stubs="$here/../../../../../packages/eval-stubs"
seed="$here/../seeds/show-me-scoped"
[ -d "$seed" ] || { echo "$seed is missing: run scripts/sync.ts pull" >&2; exit 1; }
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/bendrucker/claude.git
tar --extract --file "$seed/tree.tar"
base=$(commit 2026-09-24T15:55:00Z "Base of #1520")
git checkout -q -b show-me-ground-scoped
git apply "$seed/change.patch"
bun "$here/../scripts/plant.ts" tree none "$seed" .
head=$(commit 2026-09-24T15:55:00Z "show-me: draw existing code from the source")
bun "$here/../scripts/plant.ts" data none "$seed" "$PWD" "$base" "$head"
