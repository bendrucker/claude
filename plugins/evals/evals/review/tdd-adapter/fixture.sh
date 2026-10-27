#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stubs="$here/../../../../../packages/eval-stubs"
seed="$here/../seeds/tdd-adapter"
[ -d "$seed" ] || { echo "$seed is missing: run scripts/sync.ts pull" >&2; exit 1; }
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/bendrucker/claude.git
tar --extract --file "$seed/tree.tar"
base=$(commit 2026-09-24T03:50:00Z "Base of #1509")
git checkout -q -b climb-tdd-adapter
git apply "$seed/change.patch"
bun "$here/../scripts/plant.ts" tree none "$seed" .
head=$(commit 2026-09-24T03:50:00Z "tdd: inline the pass-in rule for dependencies")
bun "$here/../scripts/plant.ts" data none "$seed" "$PWD" "$base" "$head"
