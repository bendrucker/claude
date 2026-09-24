#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "billing", "type": "module", "scripts": { "export": "bun src/export.ts", "test": "bun test" } }
JSON
cat > src/db.ts <<'TS'
import { SQL } from "bun";

export const db = new SQL(process.env.DATABASE_URL ?? "postgres://localhost:5432/billing");

export interface Invoice {
  id: number;
  account_id: number;
  total_cents: number;
  issued_at: Date;
}

export async function invoicesFor(accountId: number): Promise<Invoice[]> {
  return db<Invoice[]>`
    SELECT id, account_id, total_cents, issued_at
    FROM invoices
    WHERE account_id = ${accountId}
    ORDER BY issued_at DESC
  `;
}
TS
cat > src/render.ts <<'TS'
import type { Invoice } from "./db";

export function render(invoices: Invoice[]): string {
  const rows = invoices.map(
    (i) => `${i.id}\t${i.issued_at.toISOString().slice(0, 10)}\t${(i.total_cents / 100).toFixed(2)}`,
  );
  return ["id\tdate\ttotal", ...rows].join("\n");
}
TS
cat > src/export.ts <<'TS'
import { invoicesFor } from "./db";
import { render } from "./render";

const accountId = Number(process.argv[2]);
const invoices = await invoicesFor(accountId);
await Bun.write(`export-${accountId}.tsv`, render(invoices));
console.log(`exported ${invoices.length} invoices`);
TS
cat > test/render.test.ts <<'TS'
import { expect, test } from "bun:test";
import { render } from "../src/render";

test("renders one row per invoice", () => {
  const out = render([{ id: 1, account_id: 7, total_cents: 1250, issued_at: new Date("2026-08-01") }]);
  expect(out.split("\n")).toEqual(["id\tdate\ttotal", "1\t2026-08-01\t12.50"]);
});
TS
git add -A && git commit -qm "billing: invoice export"
