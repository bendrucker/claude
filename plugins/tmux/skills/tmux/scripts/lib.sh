#!/usr/bin/env bash

# Print an actionable tmux-lookup failure and exit. $1 is the noun (pane/window/session).
lookup_failed() {
  echo "$1 lookup failed: cannot reach tmux${TMUX:+ at ${TMUX%%,*}}. If Claude Code's Bash sandbox is enabled, allow the tmux socket's directory under sandbox.network.allowUnixSockets (see the tmux plugin README)." >&2
  exit 1
}

# Truncate $1 to at most $2 (default 48) characters, appending an ellipsis when cut.
trunc() {
  local str=$1 max=${2:-48}
  if [ ${#str} -gt "$max" ]; then
    printf '%s…' "${str:0:$((max-1))}"
  else
    printf '%s' "$str"
  fi
}
