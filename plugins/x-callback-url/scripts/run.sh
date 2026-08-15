#!/bin/bash
# claude:dangerouslyDisableSandbox: registers with Launch Services and hands off a URL scheme to it, both of which the command sandbox blocks
set -euo pipefail

# Exit 3 separates a build failure from xcall's own exit codes (0 success,
# 1 x-error, 2 x-cancel). Exit 4 separates a wait that ran out of time. Callers
# treat any non-zero status as "no result", so without them a broken bridge is
# indistinguishable from the target app rejecting the request.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Every wait in this script is bounded from the outside. xcall cannot bound its
# own: its deadline would live in applicationDidFinishLaunching, which AppKit
# never calls when it cannot reach the WindowServer, so a sandboxed xcall would
# sit on a callback that can never arrive. The build has no deadline of its own
# either, and swiftc and lsregister both talk to system daemons.
TIMEOUT_SECONDS="${XCALL_TIMEOUT_SECONDS:-20}"
BUILD_TIMEOUT_SECONDS="${XCALL_BUILD_TIMEOUT_SECONDS:-20}"
KILL_GRACE_SECONDS=2

# Runs a command under a watchdog, returning its status, or a signal status
# (>128) when the watchdog had to stop it. The watchdog's own descriptors go to
# /dev/null so it cannot hold a caller's command substitution open past the
# command it guards.
run_bounded() {
  local limit="$1"
  shift

  # Job control gives the command its own process group, so the watchdog can
  # signal the whole tree by negating the pid. Signalling only the immediate
  # child leaves what it forked alive: build.sh runs swiftc and lsregister as
  # ordinary foreground children, and either one keeps holding the stdout this
  # function's caller reads through. The watchdog would fire, the child would
  # die, and the read would go on waiting on a grandchild nobody bounded.
  set -m
  "$@" &
  local pid=$!
  set +m

  (
    # The timer runs as a child so the trap can end it. A foreground sleep here
    # outlives the subshell blocked on it, because the cleanup kill below
    # reaches the subshell alone. Every call that finishes early would then
    # leave a sleep reparented and running out the rest of its limit.
    timer=""
    trap 'kill "${timer:-}" 2>/dev/null || true; exit 0' TERM
    sleep "$limit" &
    timer=$!
    wait "$timer"

    kill -TERM "-$pid" 2>/dev/null || exit 0
    sleep "$KILL_GRACE_SECONDS"
    kill -KILL "-$pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  local watchdog=$!

  local st=0
  # Redirected so bash's own "Terminated: 15" job notice stays out of the
  # caller's stderr. The command's own output already reached fd 2.
  wait "$pid" 2>/dev/null || st=$?

  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true

  return "$st"
}

build_status=0
BINARY="$(run_bounded "$BUILD_TIMEOUT_SECONDS" "$SCRIPT_DIR/build.sh")" || build_status=$?

if ((build_status != 0)); then
  if ((build_status > 128)); then
    echo "xcall build did not finish within ${BUILD_TIMEOUT_SECONDS}s; raise XCALL_BUILD_TIMEOUT_SECONDS if swiftc is genuinely this slow" >&2
  else
    echo "xcall build failed; see errors above" >&2
  fi
  exit 3
fi

xcall_status=0
run_bounded "$TIMEOUT_SECONDS" "$BINARY" "$@" || xcall_status=$?

# xcall exits 0, 1, or 2 on its own, so any signal status came from the watchdog.
if ((xcall_status > 128)); then
  cat >&2 <<EOF
xcall gave up after ${TIMEOUT_SECONDS}s waiting for a callback on xcall-claude://.
The command sandbox blocks the URL-scheme round trip, so the callback can never
arrive from a sandboxed process. Invoke this through a caller carrying the mac
plugin's claude:dangerouslyDisableSandbox marker, or raise XCALL_TIMEOUT_SECONDS
if the target app is genuinely slow to answer.
EOF
  exit 4
fi

exit "$xcall_status"
