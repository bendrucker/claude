#!/usr/bin/env bash
# The work-* fixtures in the eval bucket run this path. With no snapshot written, the shared
# gh and glab stand-ins print the title and body each create or edit command was given, then
# its PR-LIMIT verdicts from pr-body/limits.ts. Pass --offline to print only the verdicts and
# fail the call, for a case graded on the reply.
set -euo pipefail
here=$(dirname "${BASH_SOURCE[0]}")
bash "$here/../../../../packages/eval-stubs/install.sh" --check "$here/../pr-body/limits.ts" "$@"
