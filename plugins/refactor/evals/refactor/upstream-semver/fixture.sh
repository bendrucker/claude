#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src
cat > package.json <<'JSON'
{ "name": "releases", "type": "module", "private": true, "scripts": { "test": "bun test" }, "dependencies": { "semver": "7.7.2", "@types/semver": "7.7.0" } }
JSON
cat > src/version.ts <<'TS'
export interface Version { major: number; minor: number; patch: number; pre?: string }

export function parse(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(text.trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] };
}

export function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new Error(`bad version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) {
    if (x[k] !== y[k]) return x[k] - y[k];
  }
  return (x.pre ?? "").localeCompare(y.pre ?? "");
}

export function latest(versions: string[]): string {
  return [...versions].sort(compare).at(-1)!;
}
TS
cat > src/release.ts <<'TS'
import { latest, parse } from "./version";

export function nextTag(tags: string[]): string {
  const valid = tags.filter((t) => parse(t) !== null);
  const v = parse(latest(valid))!;
  return `v${v.major}.${v.minor}.${v.patch + 1}`;
}
TS
cat > src/version.test.ts <<'TS'
import { expect, test } from "bun:test";
import { nextTag } from "./release";

test("bumps the patch of the newest tag", () => {
  expect(nextTag(["v1.2.0", "v1.10.0", "v1.9.3", "junk"])).toBe("v1.10.1");
});
TS
bun install --silent >/dev/null 2>&1 || true
echo node_modules/ > .gitignore
git add -A && git commit -qm "releases: version helpers"
