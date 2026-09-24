#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src data
cat > package.json <<'JSON'
{ "name": "tagger", "type": "module", "scripts": { "tags": "bun src/cli.ts data/posts.txt" } }
JSON
cat > src/tags.ts <<'TS'
export function uniqueTags(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const tag of line.match(/#[\w-]+/g) ?? []) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
TS
cat > src/cli.ts <<'TS'
import { uniqueTags } from "./tags";

const [path = "data/posts.txt"] = process.argv.slice(2);
const lines = (await Bun.file(path).text()).split("\n");
const tags = uniqueTags(lines);
console.log(`${tags.length} unique tags`);
TS
# shellcheck disable=SC2016
bun -e '
const words = ["news","tech","bun","ts","js","web","perf","db","ops","ci"];
let out = "";
for (let i = 0; i < 40000; i++) out += `post ${i} #${words[i % 10]} #t${i % 20000} #x${i}\n`;
await Bun.write("data/posts.txt", out);
'
git add -A && git commit -qm "tagger: count unique tags"
cat > src/normalize.ts <<'TS'
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, "-");
}
TS
cat > src/tags.ts <<'TS'
import { normalizeTag } from "./normalize";

export function uniqueTags(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const tag of line.match(/#[\w-]+/g) ?? []) {
      const key = normalizeTag(tag);
      if (out.includes(key)) continue;
      out.push(key);
    }
  }
  return out;
}
TS
git add -A && git commit -qm "tagger: treat underscores and hyphens alike"
cat >> src/cli.ts <<'TS'
if (process.argv.includes("--list")) for (const t of tags) console.log(t);
TS
git commit -qam "tagger: add --list"
