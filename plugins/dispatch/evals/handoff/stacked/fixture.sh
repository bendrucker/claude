#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
git switch -q -c feature-x
printf '\nexport let retries = 0;\n' >> src/client.ts
commit 2026-10-02T12:00:00Z 'feature-x: count retries' > /dev/null
git push -q -u origin feature-x
