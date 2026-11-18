#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
feature retry-delay-ceiling
open_pr 57 '[{"name": "lint", "state": "fail", "elapsed": "28s"}, {"name": "test", "state": "pass", "elapsed": "3m02s"}]'
