#!/bin/sh
# Runs a notification hook's command unless the session runs inside the Claude
# desktop app, which draws its own notifications and permission prompts.
#
#   unless-desktop.sh <command> [args...]
#
# Outside the app it execs the command, so stdin, stdout, and the exit status
# pass through untouched. Inside it, the skip appends one line per call to
# ~/.claude/hook-metrics/unless-desktop.jsonl, which the session skill's
# hook-self-timing query reads.

case "${CLAUDE_CODE_ENTRYPOINT-}" in
claude-desktop*) ;;
*) exec "$@" ;;
esac

# CLAUDE_HOOK_METRICS resolves as in user/scripts/hook-metrics.ts: unset or a
# truthy value writes the default directory, 0/false/off disables, and any
# other value names the directory.
metrics=${CLAUDE_HOOK_METRICS-}
case $(printf %s "$metrics" | tr '[:upper:]' '[:lower:]') in
0 | false | off) exit 0 ;;
'' | 1 | true | on) dir=$HOME/.claude/hook-metrics ;;
*) dir=$metrics ;;
esac

log=$dir/unless-desktop.jsonl
mkdir -p "$dir" 2>/dev/null || exit 0
if [ -f "$log" ] && [ "$(wc -c <"$log")" -gt 5242880 ]; then
  mv -f "$log" "$log.1" 2>/dev/null
fi
jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
  ts: $ts,
  session_id: (.session_id // ""),
  hook_event: (.hook_event_name // ""),
  tool: (.tool_name // null),
  duration_ms: 0,
  outcome: "silent"
}' >>"$log" 2>/dev/null
exit 0
