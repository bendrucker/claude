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
{ "name": "memo", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/cache.ts <<'TS'
const store = new Map<string, unknown>();

export function get(key: string): unknown {
  return store.get(key);
}

export function set(key: string, value: unknown): void {
  store.set(key, value);
}
TS
git add -A && git commit -qm "memo: in-memory cache"
git push -qu origin main
git switch -qc cache-expiry
cat > src/cache.ts <<'TS'
const store = new Map<string, { value: unknown; expires: number }>();

export function get(key: string, now = Date.now()): unknown {
  const entry = store.get(key);
  // Expired entries are evicted lazily on read rather than by a timer.
  if (entry && entry.expires <= now) {
    store.delete(key);
    return undefined;
  }
  return entry?.value;
}

export function set(key: string, value: unknown, ttlMs = 60_000, now = Date.now()): void {
  store.set(key, { value, expires: now + ttlMs });
}
TS
cat > docs/cache.md <<'MD'
# Cache

Entries expire after `ttlMs`, 60 seconds by default. Expiry is checked on read, so an expired entry holds memory until something asks for it.
MD
git add -A && git commit -qm "memo: expire entries"
git push -qu origin cache-expiry
git switch -qc ttl-zero
cat > src/cache.ts <<'TS'
const store = new Map<string, { value: unknown; expires: number }>();

export function get(key: string, now = Date.now()): unknown {
  const entry = store.get(key);
  // Expired entries are evicted lazily on read rather than by a timer.
  if (entry && entry.expires <= now) {
    store.delete(key);
    return undefined;
  }
  return entry?.value;
}

export function set(key: string, value: unknown, ttlMs = 60_000, now = Date.now()): void {
  if (ttlMs <= 0) {
    store.delete(key);
    return;
  }
  store.set(key, { value, expires: now + ttlMs });
}
TS
git commit -qam "memo: a non-positive ttl deletes instead of storing"
