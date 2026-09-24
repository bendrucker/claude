#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/commands src/ledger src/io test
cat > src/cli.ts <<'TS'
import { parseArgs } from "./commands/parse";
import { run } from "./commands/run";

run(parseArgs(process.argv.slice(2)));
TS
cat > src/commands/parse.ts <<'TS'
export type Command = { kind: "add"; amount: number; memo: string } | { kind: "balance" } | { kind: "export"; path: string };

export function parseArgs(argv: string[]): Command {
  const [kind, ...rest] = argv;
  if (kind === "add") return { kind, amount: Number(rest[0]), memo: rest.slice(1).join(" ") };
  if (kind === "export") return { kind, path: rest[0] ?? "ledger.csv" };
  return { kind: "balance" };
}
TS
cat > src/commands/run.ts <<'TS'
import type { Command } from "./parse";
import { Ledger } from "../ledger/ledger";
import { loadEntries, saveEntries } from "../io/store";
import { toCsv } from "../io/csv";

export async function run(cmd: Command) {
  const ledger = new Ledger(await loadEntries());
  if (cmd.kind === "add") await saveEntries(ledger.add(cmd.amount, cmd.memo));
  if (cmd.kind === "balance") console.log(ledger.balance());
  if (cmd.kind === "export") await Bun.write(cmd.path, toCsv(ledger.entries));
}
TS
cat > src/ledger/ledger.ts <<'TS'
import type { Entry } from "./entry";

export class Ledger {
  constructor(readonly entries: Entry[]) {}
  add(amount: number, memo: string): Entry[] {
    return [...this.entries, { amount, memo, at: new Date().toISOString() }];
  }
  balance(): number {
    return this.entries.reduce((sum, e) => sum + e.amount, 0);
  }
}
TS
cat > src/ledger/entry.ts <<'TS'
export interface Entry {
  amount: number;
  memo: string;
  at: string;
}
TS
cat > src/io/store.ts <<'TS'
import type { Entry } from "../ledger/entry";

const PATH = `${process.env.HOME}/.ledger.json`;

export async function loadEntries(): Promise<Entry[]> {
  const file = Bun.file(PATH);
  return (await file.exists()) ? file.json() : [];
}

export async function saveEntries(entries: Entry[]) {
  await Bun.write(PATH, JSON.stringify(entries));
}
TS
cat > src/io/csv.ts <<'TS'
import type { Entry } from "../ledger/entry";

export function toCsv(entries: Entry[]): string {
  return ["at,amount,memo", ...entries.map((e) => `${e.at},${e.amount},"${e.memo}"`)].join("\n");
}
TS
cat > test/ledger.test.ts <<'TS'
import { expect, test } from "bun:test";
import { Ledger } from "../src/ledger/ledger";

test("balance sums entries", () => {
  expect(new Ledger([{ amount: 5, memo: "", at: "" }]).balance()).toBe(5);
});
TS
