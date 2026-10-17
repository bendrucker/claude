#!/bin/sh
# Runs a notification hook's command unless the session is in the Claude
# desktop app, which draws its own notifications and approvals. Skips log to
# hook metrics as `unless-desktop`.

case "${CLAUDE_CODE_ENTRYPOINT-}" in
claude-desktop*) ;;
*) exec "$@" ;;
esac

dir=$HOME/.claude/hook-metrics
log=$dir/unless-desktop.jsonl
mkdir -p "$dir" 2>/dev/null || exit 0
[ -f "$log" ] && [ "$(wc -c <"$log")" -gt 5242880 ] && mv -f "$log" "$log.1"
jq -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
  ts: $ts,
  session_id: (.session_id // ""),
  hook_event: (.hook_event_name // ""),
  tool: (.tool_name // null),
  duration_ms: 0,
  outcome: "silent"
}' >>"$log" 2>/dev/null
exit 0
