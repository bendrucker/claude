#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/users.ts <<'TS'
import { Database } from "bun:sqlite";

export interface User {
  id: number;
  name: string;
  email: string;
}

export function openStore(path = ":memory:"): Database {
  const db = new Database(path);
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)",
  );
  return db;
}

export function createUser(db: Database, input: Omit<User, "id">): User {
  const row = db
    .query("INSERT INTO users (name, email) VALUES (?, ?) RETURNING id")
    .get(input.name, input.email) as { id: number };
  return { id: row.id, ...input };
}

export function getUser(db: Database, id: number): User | undefined {
  const row = db.query("SELECT id, name, email FROM users WHERE id = ?").get(id) as User | null;
  return row ?? undefined;
}
TS
