#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stubs="$here/../../../../../packages/eval-stubs"
seed="$here/../seeds/show-me-stop"
[ -d "$seed" ] || { echo "$seed is missing: run scripts/sync.ts pull" >&2; exit 1; }
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/bendrucker/claude.git
tar --extract --file "$seed/tree.tar"
base=$(commit 2026-09-24T03:45:00Z "Base of #1506")
git checkout -q -b show-me-stop
git apply "$seed/change.patch"
bun "$here/../scripts/plant.ts" tree noise "$seed" .
head=$(commit 2026-09-24T03:45:00Z "show-me: stop once the question is answered")
bun "$here/../scripts/plant.ts" data noise "$seed" "$PWD" "$base" "$head"
