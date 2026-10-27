#!/usr/bin/env bash
# Puts a `samply` stub first on the session's PATH and starts daemon.ts outside the sandbox to run
# the stub's `samply record` requests. Run from a fixture after `git init`, since the queue lives
# under .git where the session can write without it showing in the working tree.
set -euo pipefail
if [[ "$PWD" != "$HOME/cwd" ]]; then
  echo "install.sh: refusing to edit $HOME outside a claude plugin eval workspace" >&2
  exit 1
fi
src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dir="$HOME/.samply-relay"
queue="$PWD/.git/samply-relay"
real=$(command -v samply)
mkdir -p "$dir/bin" "$queue"
cp "$src/daemon.ts" "$dir/daemon.ts"
"$real" --version > "$dir/version"
sed -e "s|@QUEUE@|$queue|" -e "s|@VERSION@|$dir/version|" "$src/stub.sh" > "$dir/bin/samply"
chmod +x "$dir/bin/samply"
for rc in .zshenv .bashrc; do
  echo "export PATH=\"$dir/bin:\$PATH\"" >> "$HOME/$rc"
done
nohup "$(command -v bun)" "$dir/daemon.ts" "$queue" "$(dirname "$HOME")" "$real" \
  < /dev/null > /dev/null 2>&1 &
disown
