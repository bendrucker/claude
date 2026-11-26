#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
printf 'test:\n\tbun test\n' > Makefile
commit 2026-10-02T12:00:00Z 'add a make test target' > /dev/null
git push -q origin main
