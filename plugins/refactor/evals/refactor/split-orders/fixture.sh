#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "shop", "type": "module", "private": true, "scripts": { "test": "bun test" } }
JSON
cat > src/registry.ts <<'TS'
const formats = new Map<string, (text: string) => string[][]>();
export function registerFormat(name: string, parse: (text: string) => string[][]) {
  formats.set(name, parse);
}
export function parserFor(name: string) {
  const parse = formats.get(name);
  if (!parse) throw new Error(`unknown format: ${name}`);
  return parse;
}
TS
cat > src/orders.ts <<'TS'
import { parserFor, registerFormat } from "./registry";

export interface Line { sku: string; qty: number; cents: number }
export interface Order { id: string; region: string; lines: Line[] }

registerFormat("csv", (text) => text.trim().split("\n").map((row) => row.split(",").map((c) => c.trim())));
registerFormat("tsv", (text) => text.trim().split("\n").map((row) => row.split("\t")));

export function parseOrders(text: string, format = "csv"): Order[] {
  const byId = new Map<string, Order>();
  for (const [id, region, sku, qty, cents] of parserFor(format)(text)) {
    const order = byId.get(id) ?? { id, region, lines: [] };
    order.lines.push({ sku, qty: Number(qty), cents: Number(cents) });
    byId.set(id, order);
  }
  return [...byId.values()];
}

const TAX: Record<string, number> = { CA: 0.0725, NY: 0.04, OR: 0 };
let taxLookups = 0;

export function taxRate(region: string): number {
  taxLookups++;
  if (!(region in TAX)) throw new Error(`no tax rate for ${region}`);
  return TAX[region];
}

export function taxLookupCount() {
  return taxLookups;
}

export function subtotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + l.qty * l.cents, 0);
}

export function total(order: Order): number {
  const sub = subtotal(order);
  return sub + Math.round(sub * taxRate(order.region));
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatReceipt(order: Order): string {
  const rows = order.lines.map((l) => `${l.sku.padEnd(10)}${String(l.qty).padStart(4)} ${money(l.qty * l.cents)}`);
  return [`Order ${order.id}`, ...rows, `Subtotal ${money(subtotal(order))}`, `Total    ${money(total(order))}`].join("\n");
}

export function formatSummary(orders: Order[]): string {
  const sum = orders.reduce((s, o) => s + total(o), 0);
  return `${orders.length} orders, ${money(sum)}`;
}
TS
cat > src/cli.ts <<'TS'
import { formatReceipt, formatSummary, parseOrders } from "./orders";

const orders = parseOrders(await Bun.stdin.text(), process.argv[2] ?? "csv");
for (const o of orders) console.log(formatReceipt(o) + "\n");
console.log(formatSummary(orders));
TS
cat > test/orders.test.ts <<'TS'
import { expect, test } from "bun:test";
import { formatReceipt, parseOrders, taxLookupCount, total } from "../src/orders";

const csv = "A1, CA, widget, 2, 1000\nA1, CA, gadget, 1, 550\nB2, OR, widget, 1, 1000";

test("groups lines by order id", () => {
  expect(parseOrders(csv).map((o) => [o.id, o.lines.length])).toEqual([["A1", 2], ["B2", 1]]);
});

test("tsv is registered on import", () => {
  expect(parseOrders("C3\tNY\tbolt\t3\t25", "tsv")[0].lines[0]).toEqual({ sku: "bolt", qty: 3, cents: 25 });
});

test("total applies the region's tax and counts lookups", () => {
  const before = taxLookupCount();
  expect(total(parseOrders(csv)[0])).toBe(2550 + 185);
  expect(taxLookupCount()).toBe(before + 1);
});

test("receipt", () => {
  expect(formatReceipt(parseOrders(csv)[1])).toBe("Order B2\nwidget       1 $10.00\nSubtotal $10.00\nTotal    $10.00");
});
TS
git add -A && git commit -qm "shop: orders"
