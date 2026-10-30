#!/usr/bin/env bash
set -euo pipefail
mkdir -p .github
cat > .github/pull_request_template.md <<'MD'
## Summary

<!-- What does this PR do and why? -->

## Changes

<!-- List the main changes. -->

## Testing

<!-- How was this tested? -->

## Checklist

- [ ] Tests added or updated
- [ ] Docs updated
MD
bash "$(dirname "$0")/../summary-fixture.sh" comment-judge-inline "comments: pass the judge workflow inline"
