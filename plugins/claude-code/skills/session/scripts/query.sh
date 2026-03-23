#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$SCRIPT_DIR/../resources"
DB_DIR="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/claude-session}"
DB="$DB_DIR/session.duckdb"
GLOB="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}/**/*.jsonl"
EMPTY="$DB_DIR/empty.jsonl"
REFRESHED_MARKER="$DB_DIR/.refreshed-${CLAUDE_SESSION_ID:-unknown}"

REFRESH=0
if [[ "${1:-}" == "--refresh" ]]; then
  REFRESH=1
  shift
fi

if [[ -z "${1:-}" ]]; then
  echo "Usage: query.sh [--refresh] <sql-query | query-name> [key=value ...]" >&2
  exit 1
fi

mkdir -p "$DB_DIR"
: > "$EMPTY"
GLOB="${GLOB//\'/\'\'}"

SCHEMA="$(cat "$RESOURCES"/schema/*.sql)"

NEEDS_REFRESH=1
if [[ "$REFRESH" -eq 0 ]] && [[ -f "$REFRESHED_MARKER" ]]; then
  NEEDS_REFRESH=0
fi

QUERY_FILE="$RESOURCES/queries/$1.sql"
if [[ -f "$QUERY_FILE" ]]; then
  QUERY_SQL="$(cat "$QUERY_FILE")"
  shift
  PARAMS=""
  for arg in "$@"; do
    key="${arg%%=*}"
    value="${arg#*=}"
    value="${value//\'/\'\'}"
    PARAMS+="SET VARIABLE \"${key}\" = '${value}';"$'\n'
  done
else
  QUERY_SQL="$1"
  PARAMS=""
fi

REFRESH_SQL=""
if [[ "$NEEDS_REFRESH" -eq 1 ]]; then
  REFRESH_SQL="$(cat <<RSQL
SET VARIABLE projects_glob = '$GLOB';
$(cat "$RESOURCES/refresh.sql")

SET VARIABLE source = (
  SELECT CASE
    WHEN LEN(getvariable('changed_files')) > 0 THEN getvariable('changed_files')
    ELSE ['$EMPTY']
  END
);

$(cat "$RESOURCES/import.sql")
RSQL
)"
fi

duckdb "$DB" -table <<SQL
$SCHEMA

$REFRESH_SQL

$PARAMS
$QUERY_SQL;
SQL

if [[ "$NEEDS_REFRESH" -eq 1 ]]; then
  touch "$REFRESHED_MARKER"
fi
