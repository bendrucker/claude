#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { ensureIndex, getDb } from "./db";

const dataDir =
  process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.TMPDIR || "/tmp", "claude-session");
mkdirSync(dataDir, { recursive: true });

const refresh = process.argv.includes("--refresh");
const db = await getDb(dataDir);

try {
  await ensureIndex(db, { dataDir, force: refresh });
} finally {
  db.close();
}

process.stdout.write(`${path.join(dataDir, "session.duckdb")}\n`);
