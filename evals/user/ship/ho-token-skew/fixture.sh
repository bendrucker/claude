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
{ "name": "sessions", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/session.ts <<'TS'
export interface Token {
  subject: string;
  expiresAt: number;
}

export function isValid(token: Token, now = Date.now()): boolean {
  return token.expiresAt > now;
}
TS
git add -A && git commit -qm "sessions: token expiry"
git push -qu origin main
git switch -qc clock-skew
cat > src/session.ts <<'TS'
export interface Token {
  subject: string;
  expiresAt: number;
  issuedAt?: number;
}

const SKEW_MS = 5 * 60_000;

export function isValid(token: Token, now = Date.now()): boolean {
  if (token.issuedAt !== undefined && token.issuedAt > now + SKEW_MS) return false;
  return token.expiresAt + SKEW_MS > now;
}
TS
git commit -qam "sessions: tolerate five minutes of clock skew"
