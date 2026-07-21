#!/bin/bash
set -euo pipefail

# Exit 3 separates a build failure from xcall's own exit codes (0 success,
# 1 x-error, 2 x-cancel). Callers treat any non-zero status as "no result", so
# without it a broken build is indistinguishable from the target app rejecting
# the request.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! BINARY="$("$SCRIPT_DIR/build.sh")"; then
  echo "xcall build failed; see errors above" >&2
  exit 3
fi

exec "$BINARY" "$@"
