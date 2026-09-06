#!/usr/bin/env bun

import { cli } from "cleye";
import { z } from "zod";
import { formatDate, selectColumns, stringify, table } from "./format";

const argv = cli({
  name: "format-output",
  flags: {
    json: {
      type: Boolean,
      description: "Pass through raw JSON",
    },
    columns: {
      type: String,
      description: "Comma-separated column filter/ordering",
    },
    countPrefix: {
      type: String,
      description: "Print 'N <text>' before the table",
    },
  },
});

const Row = z.record(z.string(), z.unknown());
const Failure = z.looseObject({ error: z.unknown() });
const Rows = z.array(Row);
const Wrapped = z.looseObject({ items: Rows.optional(), count: z.number().optional() });

const data: unknown = JSON.parse(await Bun.stdin.text());

const failure = Failure.safeParse(data);
if (failure.success) {
  console.error(failure.data.error);
  process.exit(1);
}

const bare = Rows.safeParse(data);
const wrapped = Wrapped.safeParse(data);
const items = bare.success ? bare.data : (wrapped.data?.items ?? []);
const count = bare.success ? items.length : (wrapped.data?.count ?? items.length);

if (argv.flags.json) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

if (argv.flags.countPrefix != null && argv.flags.countPrefix !== "") {
  console.log(`${count} ${argv.flags.countPrefix}\n`);
}

if (items.length === 0) {
  process.exit(0);
}

const [first] = items;
if (!first) {
  console.error("format-output: first item is not an object");
  process.exit(1);
}

const keys = Object.keys(first);
let headers = keys.map(camelToTitle);
let rows = items.map((item) =>
  keys.map((k) => {
    const v = item[k];
    if (v == null) return "";
    const s = stringify(v);
    if (isIsoDate(s)) return formatDate(s);
    return s;
  }),
);

const columns = argv.flags.columns?.split(",");
[headers, rows] = selectColumns(headers, rows, columns);
process.stdout.write(table([headers, ...rows]));

function camelToTitle(s: string): string {
  return s.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(s);
}
