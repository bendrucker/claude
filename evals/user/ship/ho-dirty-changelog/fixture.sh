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
{ "name": "dates", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/age.ts <<'TS'
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
TS
cat > CHANGELOG.md <<'MD'
# Changelog

## 0.1.0

- `daysBetween` counts whole days.
MD
git add -A && git commit -qm "dates: days between"
git push -qu origin main
git switch -qc utc-days
cat > src/age.ts <<'TS'
export function daysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(b) - day(a)) / 86_400_000);
}
TS
git commit -qam "dates: count calendar days in UTC"
cat > CHANGELOG.md <<'MD'
# Changelog

## 0.2.0

- `daysBetween` counts calendar days in UTC, so a span across a daylight-saving change no longer comes up a day short.

## 0.1.0

- `daysBetween` counts whole days.
MD
