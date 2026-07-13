#!/bin/bash
# Emit the plan-mode injection: guidelines always, plus delegation guidance when
# the session's latest assistant model is an expensive orchestrator (opus/fable).
# Fails open: any read/parse problem falls back to guidelines alone.
transcript="$1"
here=$(dirname "$0")

cat "$here/../references/guidelines.md"

# The tail bounds cost on a large transcript. It counts JSONL entries, not lines
# of one record, and the last assistant turn sits at the tail, so a generous
# ceiling keeps it in range even in a long session. Empty model falls open.
model=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  model=$(tail -n 2000 "$transcript" | jq -rs '[.[] | select(.type == "assistant") | .message.model // empty] | last // empty' 2>/dev/null)
fi

case "$model" in
  *opus* | *fable*)
    printf '\n'
    cat "$here/../references/delegation.md"
    ;;
esac
