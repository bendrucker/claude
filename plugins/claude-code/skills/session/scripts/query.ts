import * as fs from "node:fs";
import * as path from "node:path";
import { table } from "table";
import { ensureIndex, getDb, runQuery } from "./db";

const dataDir =
  process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.TMPDIR || "/tmp", "claude-session");
fs.mkdirSync(dataDir, { recursive: true });

let refresh = false;
const args = process.argv.slice(2);
if (args[0] === "--refresh") {
  refresh = true;
  args.shift();
}

const queryInput = args[0];
if (!queryInput) {
  console.error("Usage: query.ts [--refresh] <sql-query | query-name> [key=value ...]");
  process.exit(1);
}

const db = await getDb(dataDir);

try {
  await ensureIndex(db, { dataDir, force: refresh });

  const queryFile = path.join(
    import.meta.dirname,
    "..",
    "resources",
    "queries",
    `${queryInput}.sql`,
  );

  let rows: Record<string, unknown>[];
  if (fs.existsSync(queryFile)) {
    const params: Record<string, string | null> = {};
    for (const arg of args.slice(1)) {
      const eq = arg.indexOf("=");
      if (eq === -1) continue;
      params[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    rows = await runQuery(db, queryInput, params);
  } else {
    rows = await db.query(queryInput);
  }

  if (rows.length > 0) {
    const columns = Object.keys(rows[0] as Record<string, unknown>);
    const data = [columns, ...rows.map((r) => columns.map((col) => String(r[col] ?? "")))];
    process.stdout.write(table(data));
  }
} finally {
  db.close();
}
