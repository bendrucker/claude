#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../repo.sh" https://github.com/bendrucker/csv-export.git
mkdir -p tmp
cat > tmp/pr-body.md <<'MD'
Quotes CSV fields that hold a comma, a double quote, or a newline, so a spreadsheet parses each row back into the same cells.

- Doubles embedded quotes, as RFC 4180 requires.
- Leaves plain fields bare, so existing exports stay byte-identical.
MD
