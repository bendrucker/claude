#!/usr/bin/env bash
# Emit one event line per new user comment in a Hunk session; exit when the session closes.
# Designed to run under the Monitor tool. Each poll spawns short-lived commands that flush on
# exit, so events reach the monitor without buffering delay.
#
# Tracks seen noteIds (Hunk's stable per-note key, which survives --watch reloads) rather than a
# timestamp, so it never drops or re-fires a comment, even two created in the same millisecond.
#
# Usage: watch.sh <session-id> [poll-seconds]
set -uo pipefail

SID="${1:?usage: watch.sh <session-id> [poll-seconds]}"
SLEEP="${2:-2}"

seen=" " # space-delimited set of noteIds already handled (noteIds never contain spaces)

# One TSV row per user comment: noteId, file, line, one-line body.
jqfilter='.comments[]? | [.noteId, .filePath, (.newRange[0] // .oldRange[0] // "?"), (.body | gsub("\\s+"; " "))] | @tsv'

# Read TSV rows on stdin; record unseen noteIds, and announce them unless mode is "silent".
# Called with process substitution so the loop runs in this shell and `seen` persists.
scan() {
  local mode="$1" id file line body
  while IFS=$'\t' read -r id file line body; do
    [ -z "$id" ] && continue
    case "$seen" in
      *" $id "*) : ;;
      *)
        seen="$seen$id "
        [ "$mode" = announce ] && printf 'NEW %s:%s | %s\n' "$file" "$line" "$body"
        ;;
    esac
  done
}

# Arm: mark existing comments seen without announcing them.
scan silent < <(hunk session comment list "$SID" --type user --json 2>/dev/null | jq -r "$jqfilter")
echo "WATCHING $SID"

while true; do
  if ! hunk session get "$SID" >/dev/null 2>&1; then
    echo "SESSION CLOSED"
    exit 0
  fi
  scan announce < <(hunk session comment list "$SID" --type user --json 2>/dev/null | jq -r "$jqfilter")
  sleep "$SLEEP"
done
