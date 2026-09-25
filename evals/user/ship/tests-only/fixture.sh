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
{ "name": "slugger", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/slug.ts <<'TS'
export function slugify(input: string, separator = "-"): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "");
}
TS
cat > test/slug.test.ts <<'TS'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug";

test("lowercases and joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
TS
git add -A && git commit -qm "slugger: slugify"
git push -qu origin main
git switch -qc slug-edge-tests
cat > test/slug.test.ts <<'TS'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug";

test("lowercases and joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("drops leading and trailing punctuation", () => {
  expect(slugify("  --Hello, World!--  ")).toBe("hello-world");
});

test("honors a custom separator", () => {
  expect(slugify("Hello World", "_")).toBe("hello_world");
});

test("returns an empty slug for punctuation only", () => {
  expect(slugify("!!!")).toBe("");
});
TS
git commit -qam "slugger: cover punctuation and separators"
