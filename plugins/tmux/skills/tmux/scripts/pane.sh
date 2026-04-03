#!/usr/bin/env bash
set -euo pipefail

[ -z "${TMUX_PANE:-}" ] && { echo 'not running in tmux'; exit 0; }

tmux display-message -t "$TMUX_PANE" -p '- Session: #{session_name}
- Window: #{window_index} (#{window_name})
- Pane: #{pane_index} (#{pane_id})' 2>/dev/null || echo 'not running in tmux'
