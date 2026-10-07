#!/usr/bin/env bash
# Installs read-only gh and glab stand-ins into the run's home. Case sessions inherit PATH
# from the operator's shell, and the Bash tool's zsh sources only .zshenv from the run's
# home, so that file puts the stand-ins first for both eval arms.
set -euo pipefail
if [[ "$PWD" != "$HOME/cwd" ]]; then
  echo "stubs.sh: refusing to edit $HOME outside a claude plugin eval workspace" >&2
  exit 1
fi
suite=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dir="$HOME/.review-snapshot"
mkdir -p "$dir/bin"
for cli in gh glab; do
  bun build "$suite/$cli.ts" --target bun --outfile "$dir/$cli.js" > /dev/null
  printf '#!/usr/bin/env bash\nexec bun "%s" "$@"\n' "$dir/$cli.js" > "$dir/bin/$cli"
  chmod +x "$dir/bin/$cli"
done
echo "export PATH=\"$dir/bin:\$PATH\"" >> "$HOME/.zshenv"
