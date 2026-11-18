#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../fixture-lib.sh
source "$(dirname "$0")/../fixture-lib.sh"
feature cap-reconnect-backoff
open_pr 42 '[{"name": "lint", "state": "pass", "elapsed": "31s"}, {"name": "test", "state": "pending", "elapsed": "2m10s"}]'
