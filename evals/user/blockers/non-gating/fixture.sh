#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
cat > package.json <<'JSON'
{ "name": "@acme/ledger", "version": "2.3.1", "type": "module" }
JSON
cat > CHANGELOG.md <<'MD'
# Changelog

## Unreleased

- Export ledgers as Parquet.
- Fix rounding on negative balances.

## 2.3.1

- Fix the CSV header order.
MD
cat > RELEASING.md <<'MD'
# Releasing

1. Bump `version` in `package.json` and move the Unreleased changelog entries under the new version.
2. Publish with `npm publish`. CI commits and tags the release from the published version. The npm account requires a touch on Ben's hardware security key for every publish, so only Ben can run this step.
MD
git add -A
git commit -q -m "ledger: parquet export"
