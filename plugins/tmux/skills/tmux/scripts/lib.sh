#!/usr/bin/env bash

# Print an actionable tmux-lookup failure and exit. $1 is the noun (pane/window/session).
lookup_failed() {
  echo "$1 lookup failed: cannot reach tmux${TMUX:+ at ${TMUX%%,*}}. If Claude Code's Bash sandbox is enabled, allow the tmux socket's directory under sandbox.network.allowUnixSockets (see the tmux plugin README)." >&2
  exit 1
}
