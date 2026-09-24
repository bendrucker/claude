#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src data
cat > package.json <<'JSON'
{ "name": "directory", "type": "module", "scripts": { "list": "bun src/cli.ts" } }
JSON
cat > src/users.ts <<'TS'
export interface User {
  id: number;
  name: string;
}

export interface Page {
  items: User[];
  next: number | undefined;
}

export function sortUsers(users: User[]): User[] {
  return [...users].sort((a, b) => a.id - b.id);
}

export function listUsers(users: User[], limit: number, cursor?: number): Page {
  const sorted = sortUsers(users);
  const after = cursor === undefined ? sorted : sorted.filter((u) => u.id >= cursor);
  const items = after.slice(0, limit);
  const next = items.length === limit ? items[items.length - 1]!.id : undefined;
  return { items, next };
}
TS
cat > src/cli.ts <<'TS'
import users from "../data/users.json";
import { listUsers } from "./users";

const [limit = "3", cursor] = process.argv.slice(2);
const page = listUsers(users, Number(limit), cursor === undefined ? undefined : Number(cursor));
for (const u of page.items) console.log(`${u.id}\t${u.name}`);
if (page.next !== undefined) console.log(`next: ${page.next}`);
TS
cat > data/users.json <<'JSON'
[
  { "id": 14, "name": "Nadia" },
  { "id": 3, "name": "Ana" },
  { "id": 9, "name": "Lior" },
  { "id": 21, "name": "Priya" },
  { "id": 5, "name": "Chen" },
  { "id": 17, "name": "Omar" },
  { "id": 11, "name": "Mei" }
]
JSON
git add -A && git commit -qm "directory: list users with cursor pagination"
