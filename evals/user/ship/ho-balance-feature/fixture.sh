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
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
TS
cat > src/title.ts <<'TS'
export function titleCase(input: string): string {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}
TS
cat > README.md <<'MD'
# slugger
MD
cat > test/slug.test.ts <<'TS'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug";

test("joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
TS
git add -A && git commit -qm "slugger: slugify and title case"
git push -qu origin main
cat > README.md <<'MD'
# slugger

`slugify` makes URL slugs and `titleCase` makes headings. Both are pure and safe to call on user input.
MD
cat > src/title.ts <<'TS'
// Capitalizes the first letter of every word, leaving the rest untouched so acronyms survive.
export function titleCase(input: string): string {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}
TS
git add -A && git commit -qm "docs: describe the helpers"
git push -q origin main
git reset -q --hard HEAD~1
git switch -q --no-track -c slug-max-length origin/main
cat > src/slug.ts <<'TS'
export function slugify(input: string, maxLength = Infinity): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length <= maxLength ? slug : slug.slice(0, maxLength).replace(/-[^-]*$/, "");
}
TS
cat > test/slug.test.ts <<'TS'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug";

test("joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("cuts at a word boundary under the limit", () => {
  expect(slugify("the quick brown fox", 12)).toBe("the-quick");
});
TS
git commit -qam "slugger: optional max length"
