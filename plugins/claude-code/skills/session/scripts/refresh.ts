#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { ensureIndex, getDataDir, getDb, sessionDbPath } from "./db";

const dataDir = getDataDir();
mkdirSync(dataDir, { recursive: true });

const refresh = process.argv.includes("--refresh");
const db = await getDb(dataDir);

try {
  await ensureIndex(db, { dataDir, force: refresh });
} finally {
  db.close();
}

process.stdout.write(`${sessionDbPath(dataDir)}\n`);
