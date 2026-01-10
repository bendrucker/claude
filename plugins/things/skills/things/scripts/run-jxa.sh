#!/bin/bash
set -euf -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SKILL_DIR"

# Parse arguments
FILE_PATH=""
INLINE_SCRIPT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --path)
      FILE_PATH="$2"
      shift 2
      ;;
    *)
      if [ -n "$INLINE_SCRIPT" ]; then
        echo "Error: Multiple positional arguments not allowed" >&2
        exit 1
      fi
      INLINE_SCRIPT="$1"
      shift
      ;;
  esac
done

# Validate arguments
if [ -n "$FILE_PATH" ] && [ -n "$INLINE_SCRIPT" ]; then
  echo "Error: Cannot use both --path and inline script" >&2
  exit 1
fi

if [ -z "$FILE_PATH" ] && [ -z "$INLINE_SCRIPT" ]; then
  echo "Usage: run-jxa.sh --path <file.ts>" >&2
  echo "   or: run-jxa.sh '<typescript-code>'" >&2
  exit 1
fi

# Common esbuild arguments
ESBUILD_ARGS=(
  --bundle
  --platform=neutral
  --format=esm
  --log-level=error
)

# Run from file
if [ -n "$FILE_PATH" ]; then
  npx esbuild "$FILE_PATH" "${ESBUILD_ARGS[@]}" | osascript -l JavaScript -
# Run inline script
else
  printf '%s' "$INLINE_SCRIPT" | npx esbuild "${ESBUILD_ARGS[@]}" --loader=ts | osascript -l JavaScript -
fi
