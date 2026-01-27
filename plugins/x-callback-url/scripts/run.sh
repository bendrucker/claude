#!/bin/bash
set -euo pipefail

# Build xcall.app if needed, then invoke it with the given arguments
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$("$SCRIPT_DIR/build.sh")"
exec "$BINARY" "$@"
