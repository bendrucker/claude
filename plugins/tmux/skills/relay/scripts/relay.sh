#!/usr/bin/env bash
set -euo pipefail

# Send an enveloped message to another Claude pane and submit it.
#
# Usage: relay.sh <target-pane> <kind> <body...>
#   target-pane  tmux pane id of the peer (e.g. %3), in any window or session
#   kind         hello | message | handoff | ack  (free-form; routes peer behavior)
#   body         the message text; remaining args are joined with spaces
#
# The first line of what the peer receives is a machine-parseable envelope
# stamped with this pane's id, so the peer knows who sent it and where to reply.

source "$(dirname "${BASH_SOURCE[0]}")/../../tmux/scripts/lib.sh"

self="${TMUX_PANE:-}"
[ -z "$self" ] && { echo 'relay: not inside a tmux pane ($TMUX_PANE unset)' >&2; exit 1; }

target="${1:-}"
kind="${2:-message}"
[ -z "$target" ] && { echo 'relay: missing target pane (usage: relay.sh <pane> <kind> <body...>)' >&2; exit 1; }
shift 2 2>/dev/null || shift "$#"
body="$*"
[ -z "$body" ] && { echo 'relay: empty message body' >&2; exit 1; }

# Verify the target pane exists before sending; lib.sh prints the sandbox hint.
tmux display-message -t "$target" -p '' >/dev/null 2>&1 || lookup_failed pane

# Label the sender by session:window so the peer has human context, not just an id.
win="$(tmux display-message -t "$self" -p '#{session_name}:#{window_index}' 2>/dev/null || true)"

header="[[tmux-relay from=${self} reply-to=${self} kind=${kind}${win:+ window=${win}}]]"

# Deliver as a bracketed paste, then a separate Enter to submit. A raw
# `send-keys -l` would turn each newline in the body into its own Enter,
# fragmenting a multi-line handoff into several prompts; bracketed paste
# (`paste-buffer -p`) keeps newlines soft so the whole message lands as one
# prompt and the trailing Enter submits it.
buf="tmux-relay-${self#%}-$$"
printf '%s\n%s' "$header" "$body" | tmux load-buffer -b "$buf" -
tmux paste-buffer -b "$buf" -t "$target" -p -d
tmux send-keys -t "$target" Enter

echo "relayed ${kind} -> ${target} (${#body} chars)"
