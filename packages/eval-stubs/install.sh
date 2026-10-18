#!/usr/bin/env bash
# Installs the gh and glab stand-ins into the run's home, each bundled into one file so it runs
# after the staged tree is gone. Case sessions inherit PATH from the operator's shell, and the
# Bash tool's zsh sources only .zshenv from the run's home and its bash .bashrc, so those files put
# the stand-ins first for both eval arms. A fixture that writes $HOME/.eval-stubs/meta.json gets snapshot answers;
# without one, the stand-ins echo create and edit calls.
# README.md covers --check and --offline.
set -euo pipefail
check=""
offline=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      check="${2-}"
      shift 2
      ;;
    --offline)
      offline=true
      shift
      ;;
    *)
      echo "install.sh: unknown option $1" >&2
      exit 1
      ;;
  esac
done
if [[ "$PWD" != "$HOME/cwd" ]]; then
  echo "install.sh: refusing to edit $HOME outside a claude plugin eval workspace" >&2
  exit 1
fi
src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dir="$HOME/.eval-stubs"
bun=$(command -v bun)
mkdir -p "$dir/bin"
for cli in gh glab; do
  "$bun" build "$src/$cli.ts" --target bun --outfile "$dir/$cli.js" > /dev/null
  printf '#!/usr/bin/env bash\nexec "%s" "%s" "$@"\n' "$bun" "$dir/$cli.js" > "$dir/bin/$cli"
  chmod +x "$dir/bin/$cli"
done
if [[ -n "$check" ]]; then
  "$bun" build "$check" --target bun --outfile "$dir/check.js" > /dev/null
  # An empty file fails the graders when no call counts; a missing one would error the run.
  : > .eval-verdicts
fi
if $offline; then
  touch "$dir/offline"
fi
for rc in .zshenv .bashrc; do
  echo "export PATH=\"$dir/bin:\$PATH\"" >> "$HOME/$rc"
done
