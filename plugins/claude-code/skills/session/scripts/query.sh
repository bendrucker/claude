#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$SCRIPT_DIR/../resources"
DB_DIR="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}/claude-session}"
DB="$DB_DIR/session.duckdb"
GLOB="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}/**/*.jsonl"
EMPTY="$DB_DIR/empty.jsonl"

if [[ -z "${1:-}" ]]; then
  echo "Usage: query.sh <sql-query>" >&2
  exit 1
fi

mkdir -p "$DB_DIR"
: > "$EMPTY"
GLOB="${GLOB//\'/\'\'}"

SCHEMA=""
for f in "$RESOURCES"/schema/*.sql; do
  SCHEMA+="$(cat "$f")"$'\n'
done

duckdb "$DB" -table <<SQL
$SCHEMA

SET VARIABLE projects_glob = '$GLOB';
SET VARIABLE last_import_time = COALESCE(
  (SELECT last_import FROM meta LIMIT 1),
  '1970-01-01'::TIMESTAMP
);

SET VARIABLE changed_files = (
  SELECT COALESCE(LIST(filename), [])
  FROM read_text(getvariable('projects_glob'))
  WHERE last_modified > getvariable('last_import_time')
);

DELETE FROM messages WHERE session_id IN (
  SELECT regexp_extract(f, '([^/]+)\.jsonl\$', 1)
  FROM unnest(getvariable('changed_files')) t(f)
);

SET VARIABLE source = (
  SELECT CASE
    WHEN LEN(getvariable('changed_files')) > 0 THEN getvariable('changed_files')
    ELSE ['$EMPTY']
  END
);

$(cat "$RESOURCES/import.sql")

$1;
SQL
