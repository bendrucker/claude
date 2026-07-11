#!/usr/bin/env bash
# Run a named DuckDB query from resources/queries/ against ActivityWatch's
# SQLite db.
#
# aw-server-rust records device usage in a SQLite db that DuckDB attaches
# read-only. aw-server keeps its own write connection open, so a read-only
# attach is safe alongside it. The query files are pure, parameterized SQL
# (getvariable('cutoff'/'limit')); this wrapper supplies the one thing a .sql
# file can't: the shell-resolved, absolute db path for ATTACH (DuckDB does not
# expand ~).
#
# Usage:
#   aw-query.sh <query-name> [--recent <1d|7d|4w>] [-n <limit>]
#
#   aw-query.sh top-apps
#   aw-query.sh top-apps --recent 1d
#   aw-query.sh window-titles --recent 7d -n 40
#   aw-query.sh afk --recent 1d

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUERY_DIR="$SCRIPT_DIR/../resources/queries"

DB="${AW_DB:-$HOME/Library/Application Support/activitywatch/aw-server-rust/sqlite.db}"

# Convert a human-friendly duration (12h, 1d, 4w) to an epoch cutoff timestamp.
# Approximate week lengths. Precise enough for usage analysis.
duration_to_cutoff() {
  local input="$1"
  if [[ ! "$input" =~ ^[0-9]+[hHdDwW]?$ ]]; then
    echo "Invalid duration format: '$input' (expected e.g., 12h, 1d, 4w)" >&2
    return 1
  fi

  local val="${input%[hHdDwW]}"
  local unit="${input: -1}"
  local seconds

  case "$unit" in
    h|H) seconds=$((val * 3600)) ;;
    w|W) seconds=$((val * 7 * 86400)) ;;
    *)   seconds=$((val * 86400)) ;;
  esac

  echo $(( $(date +%s) - seconds ))
}

# Sensible default row cap per query.
default_limit() {
  case "$1" in
    top-apps)      echo 25 ;;
    app-timeline)  echo 100 ;;
    window-titles) echo 40 ;;
    afk)           echo 10 ;;
    *)             echo 50 ;;
  esac
}

QUERY=""
RECENT=""
LIMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recent)
      [[ $# -ge 2 ]] || { echo "--recent requires an argument" >&2; exit 1; }
      RECENT="$2"
      shift 2
      ;;
    -n)
      [[ $# -ge 2 ]] || { echo "-n requires an argument" >&2; exit 1; }
      LIMIT="$2"
      shift 2
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$QUERY" ]]; then
        QUERY="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "Usage: aw-query.sh <query-name> [--recent <dur>] [-n <limit>]" >&2
  exit 1
fi

QUERY_FILE="$QUERY_DIR/$QUERY.sql"
if [[ ! -f "$QUERY_FILE" ]]; then
  echo "Unknown query: '$QUERY'. Available:" >&2
  for f in "$QUERY_DIR"/*.sql; do
    echo "  $(basename "$f" .sql)" >&2
  done
  exit 1
fi

if [[ ! -f "$DB" ]]; then
  echo "ActivityWatch db not found: $DB" >&2
  echo "Set AW_DB or ensure ActivityWatch (aw-server-rust) is installed and capturing." >&2
  exit 1
fi

if [[ -n "$RECENT" ]]; then
  CUTOFF="$(duration_to_cutoff "$RECENT")"
else
  CUTOFF="NULL"
fi

[[ -n "$LIMIT" ]] || LIMIT="$(default_limit "$QUERY")"

duckdb <<SQL
INSTALL sqlite; LOAD sqlite;
INSTALL json; LOAD json;
ATTACH '$DB' AS aw (TYPE sqlite, READ_ONLY);
SET VARIABLE cutoff = $CUTOFF;
SET VARIABLE "limit" = $LIMIT;
.read $QUERY_FILE
SQL
