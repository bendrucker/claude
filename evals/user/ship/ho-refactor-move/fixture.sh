#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git init -q --bare .origin.git
git remote add origin "$PWD/.origin.git"
mkdir -p src
cat > package.json <<'JSON'
{ "name": "billing", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/report.ts <<'TS'
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function reportLine(date: Date, cents: number): string {
  return `${formatDate(date)}  ${formatCurrency(cents)}`;
}
TS
cat > src/invoice.ts <<'TS'
import { formatCurrency, formatDate } from "./report";

export function invoiceHeader(number: string, issued: Date, totalCents: number): string {
  return `Invoice ${number} (${formatDate(issued)}): ${formatCurrency(totalCents)}`;
}
TS
git add -A && git commit -qm "billing: reports and invoices"
git push -qu origin main
git switch -qc move-formatters
cat > src/format.ts <<'TS'
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
TS
cat > src/report.ts <<'TS'
import { formatCurrency, formatDate } from "./format";

export function reportLine(date: Date, cents: number): string {
  return `${formatDate(date)}  ${formatCurrency(cents)}`;
}
TS
cat > src/invoice.ts <<'TS'
import { formatCurrency, formatDate } from "./format";

export function invoiceHeader(number: string, issued: Date, totalCents: number): string {
  return `Invoice ${number} (${formatDate(issued)}): ${formatCurrency(totalCents)}`;
}
TS
git add -A && git commit -qm "billing: move the formatters into their own module"
