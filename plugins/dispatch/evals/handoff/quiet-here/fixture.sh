#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
sed -i.bak 's/service/servce/' README.md
rm README.md.bak
commit 2026-10-02T12:00:00Z 'readme: introduce a typo' > /dev/null
git push -q origin main
