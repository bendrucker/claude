#!/usr/bin/env bash
# Runs the suite against a copy of writing installed from its lockfile, the way
# Claude Code caches a plugin. The runner rejects symlinks, and the checkout's
# workspace node_modules are all symlinks.
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
root=$(mktemp -d "${TMPDIR:-/tmp}/no-diary-eval.XXXXXX")
rsync -a --exclude node_modules --exclude results "$repo/plugins/writing/" "$root/writing/"
(cd "$root/writing" && npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --loglevel=error)

# An API key in the environment would bill the API instead of the subscription.
exec env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  claude plugin eval "$root/writing" --eval-dir evals/no-diary --trust-plugin \
  --judge-model claude-sonnet-5 \
  --output-dir "$repo/plugins/writing/evals/no-diary/results/$(date -u +%Y-%m-%dT%H-%M-%SZ)" "$@"
