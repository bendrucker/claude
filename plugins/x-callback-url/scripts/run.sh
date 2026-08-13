#!/bin/bash
# claude:dangerouslyDisableSandbox: compiles the bridge into the plugin data dir and hands off to Launch Services, both of which the command sandbox blocks
set -euo pipefail

# Exit 3 separates a build failure from xcall's own exit codes (0 success,
# 1 x-error, 2 x-cancel). Exit 4 separates a wait that ran out of time. Callers
# treat any non-zero status as "no result", so without them a broken bridge is
# indistinguishable from the target app rejecting the request.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# xcall's own deadline lives inside applicationDidFinishLaunching, which AppKit
# never calls when it cannot reach the WindowServer, so the in-process timer is
# not a guard the bridge can rely on. This watchdog is the one that always runs.
TIMEOUT_SECONDS="${XCALL_TIMEOUT_SECONDS:-20}"
KILL_GRACE_SECONDS=2

if ! BINARY="$("$SCRIPT_DIR/build.sh")"; then
  echo "xcall build failed; see errors above" >&2
  exit 3
fi

"$BINARY" "$@" &
xcall_pid=$!

(
  sleep "$TIMEOUT_SECONDS"
  kill -TERM "$xcall_pid" 2>/dev/null || exit 0
  sleep "$KILL_GRACE_SECONDS"
  kill -KILL "$xcall_pid" 2>/dev/null || true
) &
watchdog_pid=$!

status=0
# Redirected so bash's own "Terminated: 15" job notice stays out of the caller's
# stderr. xcall's own output already reached fd 2 before the wait reaps it.
wait "$xcall_pid" 2>/dev/null || status=$?

kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true

# xcall exits 0, 1, or 2 on its own, so any signal status came from the watchdog.
if [[ $status -gt 128 ]]; then
  cat >&2 <<EOF
xcall gave up after ${TIMEOUT_SECONDS}s waiting for a callback on xcall-claude://.
The command sandbox blocks the URL-scheme round trip, so the callback can never
arrive from a sandboxed process. Invoke this through a caller carrying the mac
plugin's claude:dangerouslyDisableSandbox marker, or raise XCALL_TIMEOUT_SECONDS
if the target app is genuinely slow to answer.
EOF
  exit 4
fi

exit "$status"
