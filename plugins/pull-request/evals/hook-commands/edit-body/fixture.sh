#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../repo.sh" https://github.com/bendrucker/csv-export.git
mkdir -p tmp
cat > tmp/pr-12-body.md <<'MD'
Quotes CSV fields that hold a comma, so a spreadsheet parses each row back into the same cells.

- Leaves plain fields bare, so existing exports stay byte-identical.
MD
