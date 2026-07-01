#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$("$SCRIPT_DIR/build.sh")"
exec "$BINARY" "$@"
