#!/usr/bin/env bash
# The work-* fixtures in the eval bucket run this path. With no snapshot written, the shared
# gh and glab stand-ins print the title and body each create or edit command was given.
set -euo pipefail
bash "$(dirname "${BASH_SOURCE[0]}")/../../../../packages/eval-stubs/install.sh"
