#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { table } from "table";
import { ensureIndex, execQuery, getDb, runQuery } from "./db";

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

const dataDir =
  process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.TMPDIR || "/tmp", "claude-session");
mkdirSync(dataDir, { recursive: true });

let refresh = false;
let json = false;
let exec = false;
let queryDir: string | undefined;
const args = process.argv.slice(2);
while (args.length > 0 && args[0]?.startsWith("--")) {
  if (args[0] === "--refresh") {
    refresh = true;
    args.shift();
  } else if (args[0] === "--json") {
    json = true;
    args.shift();
  } else if (args[0] === "--exec") {
    exec = true;
    args.shift();
  } else if (args[0] === "--query-dir") {
    args.shift();
    queryDir = args.shift();
  } else break;
}

const queryInput = args[0];
if (!queryInput) {
  console.error(
    "Usage: query.ts [--refresh] [--json] [--exec] [--query-dir <path>] <sql-query | query-name> [key=value ...]",
  );
  process.exit(1);
}

const db = await getDb(dataDir);

try {
  await ensureIndex(db, { dataDir, force: refresh });

  const defaultQueriesDir = path.join(import.meta.dirname, "..", "resources", "queries");
  const resolvedQueriesDir = queryDir ?? defaultQueriesDir;
  const queryFile = path.join(resolvedQueriesDir, `${queryInput}.sql`);

  const params: Record<string, string | null> = {};
  for (const arg of args.slice(1)) {
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    params[arg.slice(0, eq)] = arg.slice(eq + 1);
  }

  if (await Bun.file(queryFile).exists()) {
    if (exec) {
      await execQuery(db, queryInput, params, resolvedQueriesDir);
    } else {
      const rows = await runQuery(db, queryInput, params, resolvedQueriesDir);
      outputRows(rows, json);
    }
  } else if (exec) {
    await db.run(queryInput, params);
  } else {
    const rows = await db.query(queryInput);
    outputRows(rows, json);
  }
} finally {
  db.close();
}

function outputRows(rows: Record<string, unknown>[], json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(rows, jsonReplacer));
    process.stdout.write("\n");
  } else if (rows.length > 0) {
    const columns = Object.keys(rows[0] as Record<string, unknown>);
    const data = [columns, ...rows.map((r) => columns.map((col) => String(r[col] ?? "")))];
    process.stdout.write(table(data));
  }
}
