#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://github.com/org/billing.git

mkdir -p src
cat > src/customers.ts <<'TS'
import type { Pool } from "pg";

export async function getCustomer(db: Pool, id: string) {
  const { rows } = await db.query("SELECT id, name, email FROM customers WHERE id = $1", [id]);
  return rows[0];
}
TS
BASE=$(commit "2026-09-01T10:00:00Z" "customers: lookup by id")

git switch -qc customer-search
cat >> src/customers.ts <<'TS'

export async function searchCustomers(db: Pool, term: string) {
  const { rows } = await db.query(
    `SELECT id, name, email FROM customers WHERE name ILIKE '%${term}%' ORDER BY name LIMIT 50`,
  );
  return rows;
}
TS
HEAD_SHA=$(commit_as "Priya Raman" praman@example.com "2026-09-06T09:00:00Z" "customers: search by name")

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
{
  root: $root,
  repo: "org/billing",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 63,
    title: "customers: search by name",
    author: "praman",
    headRefName: "customer-search",
    createdAt: "2026-09-06T09:05:00Z",
    body: "Adds `searchCustomers` for the support console's customer lookup box."
  },
  reviews: [],
  threads: []
}
JQ
