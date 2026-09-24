#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/csv-export.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
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
