#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
cat > Brewfile <<'RUBY'
brew 'git'
brew 'jq'
RUBY
cat > mise.toml <<'TOML'
[tools]
node = "22"
TOML
git add -A && git commit -qm "dotfiles: base tools"
git push -qu origin main
git switch -qc profiling-tools
cat > Brewfile <<'RUBY'
brew 'git'
brew 'jq'
brew 'samply'
brew 'hyperfine'
brew 'flamegraph'
brew 'poop'
brew 'heaptrack'
RUBY
cat > mise.toml <<'TOML'
[tools]
node = "22"
bun = "1.4"
go = "1.25"
rust = "1.90"
TOML
mkdir -p profiling
cat > profiling/Brewfile <<'RUBY'
brew 'valgrind'
brew 'uftrace'
RUBY
git add -A && git commit -qm "profiling: declare profilers and pinned runtimes"
