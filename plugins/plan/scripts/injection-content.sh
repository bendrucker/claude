#!/bin/bash
# Emit the plan-mode injection: guidelines always, plus delegation guidance when
# the session's latest assistant model is an expensive orchestrator (opus/fable).
# Fails open: any read/parse problem falls back to guidelines alone.
transcript="$1"
here=$(dirname "$0")

cat "$here/../references/guidelines.md"

model=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  model=$(tail -n 500 "$transcript" | jq -rs '[.[] | select(.type == "assistant") | .message.model // empty] | last // empty' 2>/dev/null)
fi

case "$model" in
  *opus* | *fable*)
    printf '\n'
    cat "$here/../references/delegation.md"
    ;;
esac
