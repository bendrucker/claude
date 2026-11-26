#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "ini", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON
cat > src/ini.js <<'JS'
export function parse(text) {
  const out = {};
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) throw new SyntaxError(`line ${i + 1}: expected key=value`);
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
JS
cat > test/ini.test.mjs <<'JS'
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/ini.js";

test("values stay strings", () => {
  assert.deepStrictEqual(parse("port = 8080\nname=api"), { port: "8080", name: "api" });
});

test("comments and blank lines are skipped", () => {
  assert.deepStrictEqual(parse("# c\n\nk=v\n"), { k: "v" });
});

test("a line without = names its line number", () => {
  assert.throws(() => parse("a=1\nbroken"), { name: "SyntaxError", message: "line 2: expected key=value" });
});

test("a leading = is rejected", () => {
  assert.throws(() => parse("=v"), /line 1/);
});
JS
git add -A && git commit -qm "ini: parser and tests"
