#!/usr/bin/env bash
set -euo pipefail
# The sandbox denies writes to .git/config, so keep the git dir in .repo, where push -u can set the upstream.
git init -q -b main --separate-git-dir=.repo
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .repo/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/page-kit.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .repo/origin.git
git remote set-url --push origin "$PWD/.repo/origin.git"
mkdir -p src
cat > src/page.ts <<'TS'
export function page<T>(items: T[], size: number): T[][] {
  return [items.slice(0, size)];
}
TS
git add -A && git commit -qm "page: add pagination"
git switch -qc chunk-all
cat > src/page.ts <<'TS'
export function page<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  for (let i = 0; i <= items.length; i++) {
    current.push(items[i]);
    if (current.length === size) {
      pages.push(current);
      current = [];
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
TS
git commit -qam "page: split every item into pages"
