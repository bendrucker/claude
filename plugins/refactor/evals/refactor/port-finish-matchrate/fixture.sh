#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p legacy src test corpus
cat > package.json <<'JSON'
{ "name": "expense-report", "type": "module", "private": true, "scripts": { "test": "bun test", "report": "bun src/report.ts" } }
JSON
cat > legacy/report.mjs <<'JS'
// Render an expense report from key=value records separated by blank lines.
import { readFileSync } from "node:fs";

export function parse(text) {
  const records = [];
  let current = {};
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("#")) continue;
    if (line === "") {
      if (Object.keys(current).length) records.push(current);
      current = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new Error(`bad line: ${line}`);
    current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  if (Object.keys(current).length) records.push(current);
  return records;
}

export function resolve(records) {
  return records.map((r) => ({
    name: r.name ?? "",
    amount: Number(r.amount ?? 0),
    currency: (r.currency ?? "USD").toUpperCase(),
    note: r.note ?? "",
  }));
}

const money = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function render(rows) {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const lines = ["NAME | AMOUNT | CUR | NOTE"];
  for (const r of sorted) lines.push([r.name, money(r.amount), r.currency, r.note || "-"].join(" | "));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  lines.push(`TOTAL | ${money(total)}`);
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  process.stdout.write(render(resolve(parse(readFileSync(process.argv[2] ?? 0, "utf8")))));
}
JS
cat > src/report.ts <<'TS'
import { readFileSync } from "node:fs";

export type Fields = Record<string, string>;
export type Row = { name: string; amount: number; currency: string; note: string };

export function parse(text: string): Fields[] {
  const records: Fields[] = [];
  let current: Fields = {};
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      if (Object.keys(current).length) records.push(current);
      current = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) throw new Error(`bad line: ${line}`);
    current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  if (Object.keys(current).length) records.push(current);
  return records;
}

export function resolve(records: Fields[]): Row[] {
  return records.map((r) => ({
    name: r.name ?? "",
    amount: Number(r.amount ?? 0),
    currency: r.currency?.toUpperCase() ?? "usd",
    note: r.note ?? "",
  }));
}

const money = (n: number): string => n.toFixed(2);

export function render(rows: Row[]): string {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  const lines = ["Name | Amount | Cur | Note"];
  for (const r of sorted) lines.push([r.name, money(r.amount), r.currency, r.note].join(" |"));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  lines.push(`TOTAL | ${money(total)}`);
  return lines.join("\n");
}

if (import.meta.main) {
  process.stdout.write(render(resolve(parse(readFileSync(process.argv[2] ?? 0, "utf8")))));
}
TS
cat > test/report.test.ts <<'TS'
import { describe, expect, test } from "bun:test";
import { parse, render, resolve } from "../src/report.ts";

describe("parse", () => {
  test("reads one record", () => {
    expect(parse("name=alice\namount=12.5\n")).toEqual([{ name: "alice", amount: "12.5" }]);
  });
  test("splits records on blank lines", () => {
    expect(parse("name=a\n\nname=b\n")).toEqual([{ name: "a" }, { name: "b" }]);
  });
  test("collapses repeated blank lines", () => {
    expect(parse("name=a\n\n\n\nname=b")).toHaveLength(2);
  });
  test("trims keys and values", () => {
    expect(parse("  name =  bob  \n")).toEqual([{ name: "bob" }]);
  });
  test("keeps = inside values", () => {
    expect(parse("note=a=b\n")).toEqual([{ note: "a=b" }]);
  });
  test("rejects a line without =", () => {
    expect(() => parse("oops\n")).toThrow("bad line: oops");
  });
  test("empty input has no records", () => {
    expect(parse("")).toEqual([]);
  });
});

describe("resolve", () => {
  test("converts amounts", () => {
    expect(resolve([{ name: "a", amount: "3.25", currency: "eur" }])[0].amount).toBe(3.25);
  });
  test("uppercases currency", () => {
    expect(resolve([{ name: "a", amount: "1", currency: "eur" }])[0].currency).toBe("EUR");
  });
  test("missing amount is zero", () => {
    expect(resolve([{ name: "a", currency: "gbp" }])[0].amount).toBe(0);
  });
  test("missing note is empty", () => {
    expect(resolve([{ name: "a", currency: "gbp" }])[0].note).toBe("");
  });
});

describe("render", () => {
  const rows = resolve(parse("name=alice\namount=20\ncurrency=eur\nnote=taxi\n\nname=bob\namount=35\ncurrency=eur\nnote=hotel\n"));
  test("lists every row", () => {
    const out = render(rows);
    expect(out).toContain("alice");
    expect(out).toContain("bob");
  });
  test("puts the larger amount first", () => {
    const out = render(rows);
    expect(out.indexOf("bob")).toBeLessThan(out.indexOf("alice"));
  });
  test("formats amounts with two decimals", () => {
    expect(render(rows)).toContain("35.00");
  });
  test("ends with the total", () => {
    expect(render(rows).trimEnd().split("\n").at(-1)).toBe("TOTAL | 55.00");
  });
  test("shows the currency", () => {
    expect(render(rows)).toContain("EUR");
  });
  test("shows the note", () => {
    expect(render(rows)).toContain("hotel");
  });
});
TS
bun -e '
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const names = ["alice","bob","carol","dan","erin","frank","grace","heidi","ivan","judy"];
const notes = ["taxi","hotel","lunch","flight","dinner","parking","train"];
for (let i = 1; i <= 200; i++) {
  const blocks = [];
  if (rnd() < 0.3) blocks.push("# exported " + (2026) + "-0" + (1 + Math.floor(rnd() * 9)));
  const n = 1 + Math.floor(rnd() * 4);
  const tie = rnd() < 0.2;
  for (let j = 0; j < n; j++) {
    const lines = ["name=" + pick(names)];
    const big = rnd() < 0.3;
    const amt = tie ? 40 : big ? (1000 + Math.floor(rnd() * 9000)) + rnd() : Math.floor(rnd() * 900) + Math.floor(rnd() * 100) / 100;
    lines.push("amount=" + amt.toFixed(2));
    if (rnd() > 0.2) lines.push("currency=" + pick(["usd","eur","gbp"]));
    if (rnd() > 0.3) lines.push("note=" + pick(notes));
    blocks.push(lines.join("\n"));
  }
  await Bun.write(`corpus/${String(i).padStart(3, "0")}.txt`, blocks.join("\n\n") + "\n");
}
'
git add -A && git commit -qm "report: port the expense report to TypeScript"
