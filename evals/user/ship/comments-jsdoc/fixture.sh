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
{ "name": "pager", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/pages.ts <<'TS'
export function pageCount(total: number, size: number): number {
  return Math.ceil(total / size);
}
TS
git add -A && git commit -qm "pager: page count"
git push -qu origin main
git switch -qc parse-page-range
cat > src/range.ts <<'TS'
/**
 * Parses a page selection such as "1-3,7" into sorted, unique page numbers.
 *
 * @param spec - Comma-separated pages and inclusive ranges.
 * @param max - The last valid page; pages past it are dropped.
 * @returns The selected pages in ascending order.
 */
export function parseRange(spec: string, max: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    // A bare number selects one page; "a-b" selects a through b.
    const [start, end = start] = part.trim().split("-").map(Number);
    if (start === undefined || Number.isNaN(start) || Number.isNaN(end)) continue;
    // Clamp to the document so "5-999" means "5 to the end".
    for (let page = Math.max(1, start); page <= Math.min(end, max); page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
TS
cat > test/range.test.ts <<'TS'
import { expect, test } from "bun:test";
import { parseRange } from "../src/range";

test("merges ranges and single pages", () => {
  expect(parseRange("1-3,7,2", 10)).toEqual([1, 2, 3, 7]);
});

test("clamps to the last page", () => {
  expect(parseRange("9-999", 10)).toEqual([9, 10]);
});
TS
git add -A && git commit -qm "pager: parse page ranges"
