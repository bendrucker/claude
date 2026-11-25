# shellcheck shell=bash
# Sourced by each case's fixture: installs the offline stand-ins and a recording
# claude-dispatch-close, then starts the `relay` repo on a bare local origin with a
# feature branch pushed. open_pr and no_pr set what gh reports for that branch.
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
stubs="$here/../../../../packages/eval-stubs"
bash "$stubs/install.sh"

bun=$(command -v bun)
"$bun" build "$here/stand-in.ts" --target bun --outfile "$HOME/.eval-stubs/claude-dispatch-close.js" > /dev/null
printf '#!/usr/bin/env bash\nexec "%s" "%s" "$@"\n' "$bun" "$HOME/.eval-stubs/claude-dispatch-close.js" > "$HOME/.eval-stubs/bin/claude-dispatch-close"
chmod +x "$HOME/.eval-stubs/bin/claude-dispatch-close"

for rc in .zshenv .bashrc; do
  printf '%s\n' 'export REX_BLOCK=block:sender' 'unset REX_SESSION' 'unset HERDR_ENV HERDR_PANE_ID' >> "$HOME/$rc"
  printf 'export CLAUDE_PLUGIN_DATA=%q\n' "$HOME/cwd/.dispatch-data" >> "$HOME/$rc"
done

git init -q --bare -b main "$PWD/.origin.git"
# shellcheck source=/dev/null
source "$stubs/preamble.sh" "$PWD/.origin.git"
printf '.claude/settings.local.json\ntmp/\n' > .gitignore
printf '# relay\n\nA small service.\n' > README.md
mkdir -p src
cat > src/client.ts <<'TS'
export async function connect(open: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; !(await open()); attempt++) {
    const delay = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
TS
base=$(commit 2026-10-01T12:00:00Z "relay: initial tree")
git push -q -u origin main

# feature BRANCH: commits a backoff cap on BRANCH and pushes it.
feature() {
  git switch -q -c "$1"
  sed -i.bak 's/const delay = 1000 \* 2 \*\* attempt;/const delay = Math.min(1000 * 2 ** attempt, 30_000);/' src/client.ts
  rm src/client.ts.bak
  head=$(commit 2026-10-02T12:00:00Z "client: cap reconnect backoff at 30s")
  git push -q -u origin "$1"
}

# no_pr: gh finds no pull request for any branch.
no_pr() {
  cat > "$HOME/.eval-stubs/bin/gh" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "list" ]]; then exit 0; fi
if [[ "$1" == "pr" ]]; then
  echo "no pull requests found for branch \"$(git branch --show-current)\"" >&2
  exit 1
fi
echo "gh stand-in: $* is unavailable offline" >&2
exit 1
SH
  chmod +x "$HOME/.eval-stubs/bin/gh"
}

# open_pr NUMBER CHECKS: gh reports PR NUMBER for the current branch, with CHECKS a JSON
# array of {name, state} rows for `gh pr checks`.
open_pr() {
  cat > "$HOME/.eval-stubs/meta.json" <<JSON
{
  "root": "$PWD",
  "repo": "acme/relay",
  "viewer": "bendrucker",
  "base": "$base",
  "head": "$head",
  "pull": {
    "number": $1,
    "title": "client: cap reconnect backoff at 30s",
    "body": "Caps the reconnect delay at 30 seconds.",
    "author": "bendrucker",
    "headRefName": "$(git branch --show-current)",
    "baseRefName": "main",
    "createdAt": "2026-10-02T12:05:00Z"
  },
  "reviews": [],
  "threads": [],
  "checks": $2
}
JSON
}
