# shellcheck shell=bash
# Sourced by each case's fixture: installs the offline stand-ins, then starts
# the `relay` repo on a bare local origin. second_repo NAME builds another beside it, and
# session_status STATE sets what the stand-in reports for a launched session.
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
stubs="$here/../../../../packages/eval-stubs"
bash "$stubs/install.sh"

# seed_repo NAME: starts the repo in the working directory with a bare origin and pushes main.
seed_repo() {
  git init -q --bare -b main "$PWD/.origin.git"
  # shellcheck source=/dev/null
  source "$stubs/preamble.sh" "$PWD/.origin.git"
  printf '.claude/settings.local.json\n.worktrees/\ntmp/\n' > .gitignore
  printf '# %s\n\nA small service.\n' "$1" > README.md
  mkdir -p src
  cat > src/client.ts <<'TS'
export async function connect(open: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; !(await open()); attempt++) {
    const delay = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
TS
  printf '{\n  "name": "%s",\n  "private": true,\n  "scripts": {\n    "test": "bun test"\n  }\n}\n' "$1" > package.json
  commit 2026-10-01T12:00:00Z "$1: initial tree" > /dev/null
  git push -q -u origin main
}

seed_repo relay

second_repo() {
  mkdir -p "repos/$1"
  echo "/repos/" >> .git/info/exclude
  (cd "repos/$1" && seed_repo "$1")
}

session_status() {
  printf '%s\n' "$1" > "$HOME/.eval-stubs/session-status"
}

# The sandbox denies the ledger's default home under ~/.claude/plugins.
for rc in .zshenv .bashrc; do
  printf 'export CLAUDE_PLUGIN_DATA=%q\n' "$HOME/cwd/.dispatch-data" >> "$HOME/$rc"
done

mux="${EVAL_MUX:-rex}"
# shellcheck source=/dev/null
source "$here/mux/$mux.sh"
