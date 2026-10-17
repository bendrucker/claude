#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../stubs.sh"
# The sandbox denies writes to .git/config, so keep the git dir in .repo, where push -u can set the upstream.
git init -q -b main --separate-git-dir=.repo
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .repo/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/retry-kit.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .repo/origin.git
git remote set-url --push origin "$PWD/.repo/origin.git"
mkdir -p src
cat > src/backoff.ts <<'TS'
export function delay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 5_000);
}
TS
git add -A && git commit -qm "backoff: add exponential delay"
git switch -qc jitter
cat > src/backoff.ts <<'TS'
export function delay(attempt: number): number {
  const cap = Math.min(100 * 2 ** attempt, 20_000);
  return Math.random() * cap;
}
TS
git commit -qam "backoff: use full jitter and raise the cap"
