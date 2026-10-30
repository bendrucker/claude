#!/usr/bin/env bash
set -euo pipefail
mkdir -p .github
cat > .github/pull_request_template.md <<'MD'
### What

### Why

### How to test

### Screenshots
MD
bash "$(dirname "$0")/../summary-fixture.sh" rex-code-review "review: run human review in tuicr under Rex"
