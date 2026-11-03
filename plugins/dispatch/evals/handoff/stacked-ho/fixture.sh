#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
git switch -q -c add-timeout
printf '// timeout option: wait at most this long for open()\n' >> src/client.ts
commit 2026-10-02T12:00:00Z 'add-timeout: note the option' > /dev/null
git push -q -u origin add-timeout
