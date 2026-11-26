#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src/blog src/shop src/docs
cat > package.json <<'JSON'
{ "name": "site", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON
cat > src/blog/slug.ts <<'TS'
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
TS
cat > src/blog/post.ts <<'TS'
import { slugify } from "./slug";
export const postUrl = (title: string, year: number) => `/blog/${year}/${slugify(title)}`;
TS
cat > src/shop/product.ts <<'TS'
function toSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
export const productUrl = (name: string, sku: string) => `/shop/${toSlug(name)}-${sku}`;
TS
cat > src/docs/anchor.ts <<'TS'
export function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}
TS
cat > src/urls.test.ts <<'TS'
import { expect, test } from "bun:test";
import { postUrl } from "./blog/post";
import { productUrl } from "./shop/product";
import { anchor } from "./docs/anchor";

test("post url", () => expect(postUrl("Hello World", 2026)).toBe("/blog/2026/hello-world"));
test("product url", () => expect(productUrl("Crème Brûlée Kit", "X1")).toBe("/shop/creme-brulee-kit-X1"));
test("anchor", () => expect(anchor("Getting Started")).toBe("getting-started"));
TS
git add -A && git commit -qm "site: urls"
