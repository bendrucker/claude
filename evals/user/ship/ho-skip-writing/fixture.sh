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
{ "name": "envcheck", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/check.ts <<'TS'
export function missing(required: string[], env: Record<string, string | undefined>): string[] {
  return required.filter((name) => env[name] === undefined);
}
TS
cat > README.md <<'MD'
# envcheck

`missing(["DATABASE_URL"], process.env)` lists required variables that are unset.
MD
git add -A && git commit -qm "envcheck: missing variables"
git push -qu origin main
git switch -qc blank-counts-missing
cat > src/check.ts <<'TS'
export function missing(required: string[], env: Record<string, string | undefined>): string[] {
  return required.filter((name) => (env[name] ?? "").trim() === "");
}
TS
cat > README.md <<'MD'
# envcheck

`missing(["DATABASE_URL"], process.env)` lists required variables that are unset or blank. A variable holding only whitespace counts as missing, since it almost always means a template was never filled in.
MD
git add -A && git commit -qm "envcheck: treat blank variables as missing"
