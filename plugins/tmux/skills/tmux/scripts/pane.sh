#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

target="${1:-${TMUX_PANE:-}}"
[ -z "$target" ] && { echo 'no pane target' >&2; exit 1; }

tmux display-message -t "$target" -p -- '- Session: #{session_name}
- Window: #{window_index} (#{window_name})
- Pane: #{pane_index} (#{pane_id})' 2>/dev/null || lookup_failed pane
