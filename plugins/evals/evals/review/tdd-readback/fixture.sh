#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
stubs="$here/../../../../../packages/eval-stubs"
seed="$here/../seeds/tdd-readback"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/bendrucker/claude.git
tar --extract --file "$seed/tree.tar"
base=$(commit 2026-09-24T03:54:00Z "Base of #1510")
git checkout -q -b climb-tdd-readback
git apply "$seed/change.patch"
bun "$here/../scripts/plant.ts" tree none "$seed" .
head=$(commit 2026-09-24T03:54:00Z "tdd: verify writes by reading them back")
bun "$here/../scripts/plant.ts" data none "$seed" "$PWD" "$base" "$head"
