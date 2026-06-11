#!/usr/bin/env bash
# Emit one event line per new comment in a tuicr review session; exit when the session goes away.
# Designed to run under the Monitor tool. Each poll spawns short-lived commands that flush on
# exit, so events reach the monitor without buffering delay.
#
# tuicr has no push stream, so this polls `tuicr review comments` and tracks seen comment IDs
# (tuicr's stable per-comment key) rather than a timestamp, so it never drops or re-fires a
# comment, even two created in the same second.
#
# Usage: watch.sh <session-slug> [--repo <path>] [poll-seconds]
set -uo pipefail

SLUG="${1:?usage: watch.sh <session-slug> [--repo <path>] [poll-seconds]}"
shift

REPO="."
SLEEP="30"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs a path}"; shift 2 ;;
    *) SLEEP="$1"; shift ;;
  esac
done

seen=" " # space-delimited set of comment IDs already handled (IDs never contain spaces)

# One TSV row per comment: id, location (path:line), one-line content.
jqfilter='.[]? | [.id, .location, (.content | gsub("\\s+"; " "))] | @tsv'

comments() {
  tuicr review comments --repo "$REPO" --session "$SLUG" 2>/dev/null | jq -r "$jqfilter" 2>/dev/null
}

# Read TSV rows on stdin; record unseen IDs, and announce them unless mode is "silent".
# Called with process substitution so the loop runs in this shell and `seen` persists.
scan() {
  local mode="$1" id location content
  while IFS=$'\t' read -r id location content; do
    [ -z "$id" ] && continue
    case "$seen" in
      *" $id "*) : ;;
      *)
        seen="$seen$id "
        [ "$mode" = announce ] && printf 'NEW %s | %s\n' "$location" "$content"
        ;;
    esac
  done
}

# Arm: mark existing comments seen without announcing them.
scan silent < <(comments)
echo "WATCHING $SLUG"

while true; do
  if ! tuicr review comments --repo "$REPO" --session "$SLUG" >/dev/null 2>&1; then
    echo "SESSION CLOSED"
    exit 0
  fi
  scan announce < <(comments)
  sleep "$SLEEP"
done
