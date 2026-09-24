#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "manifest", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/manifest.ts <<'TS'
export interface Manifest {
  name: string;
  version: string;
}

export function parseManifest(text: string): Manifest {
  const data = JSON.parse(text) as Partial<Manifest>;
  if (typeof data.name !== "string") throw new TypeError("manifest is missing a name");
  if (typeof data.version !== "string") throw new TypeError("manifest is missing a version");
  return { name: data.name, version: data.version };
}
TS
cat > test/manifest.test.ts <<'TS'
import { expect, test } from "bun:test";
import { parseManifest } from "../src/manifest";

test("reads name and version", () => {
  expect(parseManifest('{"name":"a","version":"1.0.0"}')).toEqual({ name: "a", version: "1.0.0" });
});
TS
git add -A && git commit -qm "manifest: parse name and version"
