#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p bin
cat > package.json <<'JSON'
{ "name": "du", "type": "module", "bin": { "du-lite": "bin/du.ts" } }
JSON
cat > bin/du.ts <<'TS'
#!/usr/bin/env bun
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? ".";
for (const name of readdirSync(dir)) {
  console.log(`${statSync(join(dir, name)).size}\t${name}`);
}
TS
git add -A && git commit -qm "du-lite: list file sizes"
git push -qu origin main
git switch -qc human-sizes
cat > bin/du.ts <<'TS'
#!/usr/bin/env bun
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function human(bytes: number): string {
  const units = ["B", "K", "M", "G"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${i === 0 ? bytes : bytes.toFixed(1)}${units[i]}`;
}

const args = process.argv.slice(2);
const readable = args.includes("-h");
const dir = args.find((a) => a !== "-h") ?? ".";
const entries = readdirSync(dir).map((name) => ({ name, size: statSync(join(dir, name)).size }));
for (const { name, size } of entries.sort((a, b) => b.size - a.size)) {
  console.log(`${readable ? human(size) : size}\t${name}`);
}
TS
git commit -qam "du-lite: sort by size and add -h"
