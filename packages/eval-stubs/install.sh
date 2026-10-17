#!/usr/bin/env bash
# Installs the gh and glab stand-ins into the run's home, each bundled into one file so it runs
# after the staged tree is gone. Case sessions inherit PATH from the operator's shell, and the
# Bash tool's zsh sources only .zshenv from the run's home, so that file puts the stand-ins first
# for both eval arms. A fixture that writes $HOME/.eval-stubs/meta.json gets snapshot answers;
# without one, the stand-ins echo create and edit calls.
set -euo pipefail
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
echo "export PATH=\"$dir/bin:\$PATH\"" >> "$HOME/.zshenv"
