#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src docs
cat > package.json <<'JSON'
{ "name": "units", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/units.ts <<'TS'
export function bytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
TS
cat > docs/usage.md <<'MD'
# Usage

`bytes(2048)` returns `"2.0 KB"`.
MD
git add -A && git commit -qm "units: byte formatting"
git push -qu origin main
git switch -qc megabytes
cat > src/units.ts <<'TS'
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
TS
git commit -qam "units: format megabytes"
cat > docs/usage.md <<'MD'
# Usage

`bytes(2048)` returns `"2.0 KB"`, and anything from 1 MB up switches units: `bytes(3 * 1024 ** 2)` returns `"3.0 MB"`.
MD
