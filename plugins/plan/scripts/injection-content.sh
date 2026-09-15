#!/bin/bash
# Emit the plan-mode injection: guidelines always, plus delegation guidance when
# the session's latest assistant model is an expensive orchestrator (opus/fable/mythos).
# Fails open: any read/parse problem falls back to guidelines alone.
transcript="$1"
here=$(dirname "$0")

cat "$here/../references/guidelines.md"

# The tail bounds cost on a large transcript. It counts JSONL entries, not lines
# of one record, and the last assistant turn sits at the tail, so a generous
# ceiling keeps it in range even in a long session. Reversing that window lets
# jq stop at the first assistant entry rather than parse every record in it.
# tail -r is BSD, tac is GNU; neither ships both.
model=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  if tail -r </dev/null >/dev/null 2>&1; then
    reverse=(tail -r)
  else
    reverse=(tac)
  fi
  model=$(
    tail -n 2000 "$transcript" | "${reverse[@]}" |
      jq -rn 'first(inputs | select(.type == "assistant") | .message.model // empty)' 2>/dev/null
  )
fi

case "$model" in
  *opus* | *fable* | *mythos*)
    printf '\n'
    cat "$here/../references/delegation.md"
    ;;
esac
