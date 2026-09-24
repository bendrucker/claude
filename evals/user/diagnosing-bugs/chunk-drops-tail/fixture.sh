#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src data
cat > package.json <<'JSON'
{ "name": "importer", "type": "module", "scripts": { "import": "bun src/import.ts data/contacts.jsonl" } }
JSON
cat > src/batch.ts <<'TS'
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i + size <= items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
TS
cat > src/import.ts <<'TS'
import { chunk } from "./batch";

interface Contact {
  email: string;
}

async function upload(batch: Contact[]): Promise<number> {
  return batch.length;
}

const [path = "data/contacts.jsonl", size = "25"] = process.argv.slice(2);
const lines = (await Bun.file(path).text()).trim().split("\n");
const contacts: Contact[] = lines.map((line) => JSON.parse(line));
let imported = 0;
for (const batch of chunk(contacts, Number(size))) imported += await upload(batch);
console.log(`read ${contacts.length} contacts, imported ${imported}`);
TS
for i in $(seq 1 107); do echo "{\"email\":\"user$i@example.com\"}"; done > data/contacts.jsonl
git add -A && git commit -qm "importer: upload contacts in batches"
