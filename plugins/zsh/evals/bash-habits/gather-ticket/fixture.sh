#!/usr/bin/env bash
# A small multi-language app: TS server, Vue client, SQL migrations, shell scripts.
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"; git config user.email bvdrucker@gmail.com; git config commit.gpgsign false
mkdir -p server/src/routes server/src/db server/src/jobs server/test client/src/components client/src/stores client/src/pages migrations scripts docs node_modules/left-pad
printf '{\n  "name": "ledger",\n  "private": true,\n  "workspaces": ["server", "client"]\n}\n' > package.json
printf '# Ledger\n\nTracks invoices. `server/` is a Hono API, `client/` is Vue.\n' > README.md
cat > server/src/db/invoices.ts <<'TS'
import { sql } from "./client";

export interface Invoice { id: string; customerId: string; amountCents: number; status: "draft" | "sent" | "paid"; }

export async function listInvoices(customerId: string): Promise<Invoice[]> {
  return sql`select * from invoices where customer_id = ${customerId}`;
}

export async function markPaid(id: string): Promise<void> {
  await sql`update invoices set status = 'paid', paid_at = now() where id = ${id}`;
}
TS
printf 'export const sql = (..._args: unknown[]): any => [];\n' > server/src/db/client.ts
cat > server/src/routes/invoices.ts <<'TS'
import { listInvoices, markPaid } from "../db/invoices";

export const routes = {
  "GET /customers/:id/invoices": (id: string) => listInvoices(id),
  "POST /invoices/:id/pay": (id: string) => markPaid(id),
};
TS
cat > server/src/jobs/reminders.ts <<'TS'
import { listInvoices } from "../db/invoices";

export async function remind(customerId: string) {
  const unpaid = (await listInvoices(customerId)).filter((i) => i.status === "sent");
  return unpaid.map((i) => `Invoice ${i.id}: ${i.amountCents / 100} due`);
}
TS
cat > server/test/invoices.test.ts <<'TS'
import { markPaid } from "../src/db/invoices";
test("markPaid", async () => { await markPaid("inv_1"); });
TS
cat > client/src/stores/invoices.ts <<'TS'
export const useInvoices = () => ({ items: [] as { id: string; status: string; amountCents: number }[] });
TS
cat > client/src/components/InvoiceRow.vue <<'VUE'
<script setup lang="ts">
defineProps<{ invoice: { id: string; status: string; amountCents: number } }>();
</script>
<template><tr><td>{{ invoice.id }}</td><td>{{ invoice.status }}</td><td>{{ invoice.amountCents / 100 }}</td></tr></template>
VUE
cat > client/src/pages/Invoices.vue <<'VUE'
<script setup lang="ts">
import InvoiceRow from "../components/InvoiceRow.vue";
import { useInvoices } from "../stores/invoices";
const store = useInvoices();
async function pay(id: string) { await fetch(`/invoices/${id}/pay`, { method: "POST" }); }
</script>
<template><table><InvoiceRow v-for="i in store.items" :key="i.id" :invoice="i" @click="pay(i.id)" /></table></template>
VUE
printf 'create table invoices (\n  id text primary key,\n  customer_id text not null,\n  amount_cents integer not null,\n  status text not null default '"'"'draft'"'"'\n);\n' > migrations/001_invoices.sql
printf 'alter table invoices add column paid_at timestamptz;\n' > migrations/002_paid_at.sql
printf '#!/bin/sh\npsql "$DATABASE_URL" -c "select count(*) from invoices where status = '"'"'sent'"'"'"\n' > scripts/unpaid.sh
printf '# Invoices\n\nAn invoice moves draft -> sent -> paid. `markPaid` stamps `paid_at`.\n' > docs/invoices.md
printf 'module.exports = (s) => s;\n' > node_modules/left-pad/index.js
git add -A && git commit -qm "invoices: list, pay, remind"
git checkout -qb refund-status
sed -i.bak 's/"draft" | "sent" | "paid"/"draft" | "sent" | "paid" | "refunded"/' server/src/db/invoices.ts
cat >> server/src/db/invoices.ts <<'TS'

export async function refund(id: string): Promise<void> {
  await sql`update invoices set status = 'refunded' where id = ${id}`;
}
TS
printf 'import { refund } from "../db/invoices";\nexport const refundRoute = (id: string) => refund(id);\n' > server/src/routes/refunds.ts
rm -f server/src/db/invoices.ts.bak
git add -A && git commit -qm "invoices: add refunded status"
