#!/usr/bin/env bash
set -euo pipefail

extract_dirs() {
  local depth=$1
  shift
  local path dir
  for path in "$@"; do
    case "$path" in
      /* | ../* | */../*) continue ;;
    esac
    dir=$(printf '%s\n' "$path" | cut -d/ -f1-"$depth")
    [ -d "$dir" ] || continue
    printf '%s\n' "$dir"
  done | sort -u
}

case "${1:-}" in
  plugin-test)
    shift
    for dir in $(extract_dirs 2 "$@"); do
      if find "$dir" -name '*.test.ts' -print -quit | grep -q .; then
        bun test "$dir/"
      fi
    done
    ;;
  plugin-validate)
    shift
    for dir in $(extract_dirs 2 "$@"); do
      bun packages/validate/plugin.ts "$dir"
    done
    ;;
  hooks-validate)
    shift
    for dir in $(extract_dirs 2 "$@"); do
      bun packages/validate/hooks.ts "$dir"
    done
    ;;
  skill-lint)
    shift
    dirs=$(extract_dirs 4 "$@")
    # shellcheck disable=SC2086
    bun run skill-lint $dirs
    ;;
  *)
    echo "Unknown subcommand: ${1:-}" >&2
    exit 1
    ;;
esac
