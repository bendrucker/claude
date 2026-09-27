#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src
cat > package.json <<'JSON'
{ "name": "geo", "type": "module", "devDependencies": { "typescript": "^5.6.3" } }
JSON
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": { "target": "ES2020", "module": "ESNext", "strict": true }
}
JSON
cat > src/distance.ts <<'TS'
export function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
TS
git add -A && git commit -qm "geo: distance"
git push -qu origin main
git switch -qc tsconfig-es2022
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
JSON
git commit -qam "tsconfig: target ES2022 and check indexed access"
