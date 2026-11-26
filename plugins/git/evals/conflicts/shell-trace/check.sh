#!/usr/bin/env bash
set -euo pipefail
test ! -e scripts/install-topics
if grep -nE 'trace_run|build-default-packages|install-topics' bin/dotf scripts/install scripts/bootstrap scripts/shell/trace.sh; then
  echo "retired step left behind" >&2
  exit 1
fi
zsh -n scripts/install
sh -n bin/dotf
command -v shellcheck > /dev/null
shellcheck --shell=sh --severity=warning bin/dotf scripts/shell/trace.sh
[ "$(grep -c '^trace_begin' scripts/install)" = "$(grep -c '^trace_end' scripts/install)" ]
events=$(mktemp -d "${TMPDIR:-/tmp}/trace.XXXXXX")
DOTFILES_TRACE_DIR="$events" sh -c '. scripts/shell/trace.sh; trace_begin step; trace_end'
grep -q '^B' "$events/events.tsv"
grep -q '^E' "$events/events.tsv"
