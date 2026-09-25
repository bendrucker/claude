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
{ "name": "admin-api", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/auth.ts <<'TS'
export interface Principal {
  id: string;
  roles: string[];
}

export function authorize(principal: Principal, role: string): boolean {
  return principal.roles.includes(role);
}
TS
git add -A && git commit -qm "admin-api: role checks"
git push -qu origin main
git switch -qc token-scopes
cat > src/auth.ts <<'TS'
export interface Principal {
  id: string;
  roles: string[];
  scopes?: string[];
}

export function authorize(principal: Principal, role: string): boolean {
  if (principal.roles.includes("admin")) return true;
  if (principal.scopes !== undefined && !principal.scopes.includes(role)) return false;
  return principal.roles.includes(role);
}
TS
git commit -qam "admin-api: admins pass every check, tokens limited to their scopes"
