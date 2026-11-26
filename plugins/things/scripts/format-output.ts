#!/usr/bin/env bun

import { Command } from "@commander-js/extra-typings";
import { z } from "zod";
import { formatDate, selectColumns, stringify, table } from "./format";

const Row = z.record(z.string(), z.unknown());
const Failure = z.looseObject({ error: z.unknown() });
const Rows = z.array(Row);
const Wrapped = z.looseObject({ items: Rows.optional(), count: z.number().optional() });

export const program = new Command("format-output")
  .option("--json", "Pass through raw JSON")
  .option("--columns <list>", "Comma-separated column filter/ordering")
  .option("--count-prefix <text>", "Print 'N <text>' before the table")
  .action(async (flags) => {
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

    if (flags.json) {
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
    }

    if (flags.countPrefix != null && flags.countPrefix !== "") {
      console.log(`${count} ${flags.countPrefix}\n`);
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
    const allHeaders = keys.map(camelToTitle);
    const allRows = items.map((item) =>
      keys.map((k) => {
        const v = item[k];
        if (v == null) return "";
        const s = stringify(v);
        if (isIsoDate(s)) return formatDate(s);
        return s;
      }),
    );

    const columns = flags.columns?.split(",");
    const [headers, rows] = selectColumns(allHeaders, allRows, columns);
    process.stdout.write(table([headers, ...rows]));
  });

if (import.meta.main) {
  await program.parseAsync();
}

function camelToTitle(s: string): string {
  return s.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(s);
}
