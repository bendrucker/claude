#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "feed", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/feed.ts <<'TS'
export interface Post {
  id: number;
  at: number;
}

export function nextPage(posts: Post[], cursor: number, size: number): Post[] {
  const sorted = [...posts].sort((a, b) => b.at - a.at);
  const start = sorted.findIndex((p) => p.id === cursor);
  return sorted.slice(start, start + size);
}
TS
git add -A && git commit -qm "feed: cursor pagination"
git push -qu origin main
git switch -qc fix-cursor-repeat
cat > src/feed.ts <<'TS'
export interface Post {
  id: number;
  at: number;
}

export function nextPage(posts: Post[], cursor: number, size: number): Post[] {
  // Ties on timestamp fall back to id so the order is stable across calls.
  const sorted = [...posts].sort((a, b) => b.at - a.at || b.id - a.id);
  const index = sorted.findIndex((p) => p.id === cursor);
  // The cursor names the last post the client already has, so the page starts after it.
  // An unknown cursor restarts from the top instead of returning the tail.
  const start = index === -1 ? 0 : index + 1;
  return sorted.slice(start, start + size);
}
TS
cat > test/feed.test.ts <<'TS'
import { expect, test } from "bun:test";
import { nextPage } from "../src/feed";

const posts = [1, 2, 3, 4].map((id) => ({ id, at: 100 - id }));

test("starts after the cursor", () => {
  expect(nextPage(posts, 2, 2).map((p) => p.id)).toEqual([3, 4]);
});
TS
git add -A && git commit -qm "feed: stop repeating the cursor post"
