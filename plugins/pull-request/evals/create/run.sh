#!/usr/bin/env bash
# Runs the pull-request:create suite against copies of pull-request and writing,
# installed from their lockfiles the way Claude Code caches a plugin. The runner
# rejects symlinks, and the checkout's workspace node_modules are all symlinks.
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
# A fresh root per run, so runs from sibling worktrees can go in parallel.
root=${EVAL_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/pr-create-eval.XXXXXX")}

pids=()
for plugin in pull-request writing; do
  (
    rsync -a --delete --exclude node_modules --exclude results "$repo/plugins/$plugin/" "$root/$plugin/"
    cd "$root/$plugin" && npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --loglevel=error
  ) &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done

out="$repo/plugins/pull-request/evals/create/results/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$out"

# The runner passes ANTHROPIC_* through to every agent session, and an API key
# there bills the API instead of the logged-in subscription.
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  claude plugin eval "$root" --eval-dir pull-request/evals/create --scaffold --trust-plugin \
  --allow-tools "Bash(git:*)" "Bash(bun:*)" Write \
  --judge-model claude-sonnet-5 --keep-temp --json "$out/result.json" \
  --output-dir "$out" --report "$out/report.html" "$@" || code=$?

# The runner deletes traces with its scaffold dirs unless kept, and the bodies
# they hold are what a grader verdict gets checked against.
mkdir -p "$out/traces"
jq -r '.cases[] | .name as $c | .arms | to_entries[] | .key as $a
  | .value | to_entries[] | [$c, $a, .key, .value.tracePath] | @tsv' "$out/result.json" |
  while IFS=$'\t' read -r name arm run trace; do
    [[ -f $trace ]] || continue
    cp "$trace" "$out/traces/$name-$arm-$run.jsonl"
    # The runner seals a write-only subdir that a recursive chmod cannot descend.
    scaffold=$(dirname "$(dirname "$trace")")
    if [[ $(basename "$scaffold") == e-* ]]; then
      chmod u+rwx "$scaffold/sealed" 2>/dev/null || true
      chmod -R u+rwx "$scaffold" && rm -rf "$scaffold" || true
    fi
  done

exit "${code:-0}"
