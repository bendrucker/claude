#!/usr/bin/env bash
# Record or drop a deferral, the write half of the loop claim.sh reports on.
#
#   defer.sh <key> <reason>   record, dated today
#   defer.sh --drop <key>     remove, once the work lands
set -uo pipefail

DEFERRED="${XDG_CACHE_HOME:-$HOME/.cache}/claude/flock/deferred.json"

usage() {
  echo "usage: defer.sh <key> <reason> | defer.sh --drop <key>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
mkdir -p "$(dirname "$DEFERRED")" || exit 1
[ -s "$DEFERRED" ] || echo '{}' > "$DEFERRED"

tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT

if [ "$1" = "--drop" ]; then
  jq --arg k "$2" 'del(.[$k])' "$DEFERRED" > "$tmp" || exit 1
  action="dropped"
  key=$2
else
  jq --arg k "$1" --arg r "$2" --arg d "$(date +%Y-%m-%d)" \
    '.[$k] = {reason: $r, since: $d}' "$DEFERRED" > "$tmp" || exit 1
  action="deferred"
  key=$1
fi

mv "$tmp" "$DEFERRED" && echo "$action: $key"
