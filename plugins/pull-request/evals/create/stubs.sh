#!/usr/bin/env bash
# Installs the shared gh and glab stand-ins offline: a create or edit prints its PR-LIMIT
# verdicts from pr-body/limits.ts and then fails, so the session still replies with the draft.
set -euo pipefail
bash "$(dirname "${BASH_SOURCE[0]}")/../create-scenarios/stubs.sh" --offline
