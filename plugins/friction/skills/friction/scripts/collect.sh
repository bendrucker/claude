#!/bin/sh
# Runs every named query for one source over the window ending on DAY and spanning DAYS.
# Prints each query's name, then its rows as a JSON array.
# FRICTION_OSQUERY_DIR and FRICTION_ATUIN_DB override the default log locations.
set -eu
src=$1 day=${2:-$(date +%F)} days=${3:-1}
dir=$(dirname "$0")/../queries/$src
{
  echo "SET VARIABLE day = DATE '$day'; SET VARIABLE days = $days;"
  echo "SET VARIABLE osquery_dir = '${FRICTION_OSQUERY_DIR:-$HOME/.local/state/osquery}';"
  echo "SET VARIABLE atuin_db = '${FRICTION_ATUIN_DB:-$HOME/.local/share/atuin/history.db}';"
  cat "$dir/load.sql"
  for f in "$dir"/*.sql; do
    name=$(basename "$f" .sql)
    [ "$name" = load ] && continue
    echo ".print -- $name"
    cat "$f"
  done
} | duckdb -json
