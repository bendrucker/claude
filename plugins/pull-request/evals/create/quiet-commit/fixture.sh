#!/usr/bin/env bash
set -euo pipefail
# The sandbox denies writes to .git/config, so keep the git dir in .repo, where push -u can set the upstream.
git init -q -b main --separate-git-dir=.repo
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .repo/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/csv-export.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .repo/origin.git
git remote set-url --push origin "$PWD/.repo/origin.git"
mkdir -p src
cat > src/export.ts <<'TS'
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\n");
}
TS
git add -A && git commit -qm "export: add csv export"
git switch -qc quote-fields
cat > src/export.ts <<'TS'
function quote(field: string): string {
  return /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(quote).join(",")).join("\n");
}
TS
