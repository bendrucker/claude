#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$SCRIPT_DIR/../resources"
DB_DIR="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/claude-session}"
DB="$DB_DIR/session.duckdb"
GLOB="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}/**/*.jsonl"
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

if [[ "$NEEDS_REFRESH" -eq 1 ]]; then
  CHANGED_LIST="$DB_DIR/changed_files.list"

  duckdb "$DB" -noheader -list <<SQL > "$CHANGED_LIST"
$SCHEMA
SET VARIABLE projects_glob = '$GLOB';
$(cat "$RESOURCES/refresh.sql")
SELECT unnest(getvariable('changed_files'));
SQL

  if [[ -s "$CHANGED_LIST" ]]; then
    SOURCE_ARRAY="[$(sed "s/'/''/g; s/.*/'&'/" "$CHANGED_LIST" | paste -sd, -)]"
    duckdb "$DB" <<SQL
SET VARIABLE source = $SOURCE_ARRAY;
$(cat "$RESOURCES/import.sql")
$(cat "$RESOURCES/views.sql")
SQL
  fi
fi

duckdb "$DB" -table <<SQL
$SCHEMA
$PARAMS
$QUERY_SQL;
SQL

if [[ "$NEEDS_REFRESH" -eq 1 ]]; then
  touch "$REFRESHED_MARKER"
fi
