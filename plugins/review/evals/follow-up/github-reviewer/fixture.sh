#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../stubs.sh"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/acme/api-server.git

commit() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
  git rev-parse HEAD
}

mkdir -p src/routes src/db src/lib test
cat > package.json <<'JSON'
{ "name": "api-server", "type": "module", "scripts": { "test": "bun test" }, "dependencies": { "pg": "^8.13.0", "express": "^5.1.0" } }
JSON
cat > src/db/pool.ts <<'TS'
import pg from "pg";

export const pool = new pg.Pool({ max: 10 });

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  const result = await client.query(sql, params);
  client.release();
  return result.rows as T[];
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const value = await fn(client);
    await client.query("COMMIT");
    client.release();
    return value;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
TS
cat > src/lib/retry.ts <<'TS'
export async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
TS
cat > src/routes/users.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";

export async function listUsers(_req: Request, res: Response) {
  const users = await query("SELECT id, name FROM users ORDER BY id");
  res.json({ users });
}
TS
cat > src/routes/orders.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";

export async function listOrders(req: Request, res: Response) {
  const orders = await query("SELECT id, total FROM orders WHERE user_id = $1 ORDER BY id", [req.user.id]);
  res.json({ orders });
}
TS
cat > test/users.test.ts <<'TS'
import { expect, test } from "bun:test";

test("placeholder", () => {
  expect(true).toBe(true);
});
TS
BASE=$(commit "Ben Drucker" bvdrucker@gmail.com "2026-09-01T10:00:00Z" "api: users and orders routes")

git switch -qc users-pagination
cat > src/routes/users.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";

export async function listUsers(req: Request, res: Response) {
  const limit = req.query.limit ?? 20;
  const after = Number(req.query.after ?? 0);
  const users = await query("SELECT id, name FROM users WHERE id > $1 ORDER BY id LIMIT $2", [after, limit]);
  res.json({ users, next: users.at(-1)?.id ?? null });
}
TS
cat > src/routes/orders.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";
import { retry } from "../lib/retry";

interface Order {
  id: number;
  total: number;
}

export async function listOrders(req: Request, res: Response) {
  const after = Number(req.query.after ?? 0);
  const orders = await retry(() =>
    query<Order>("SELECT id, total FROM orders WHERE id > $1 ORDER BY id LIMIT 50", [after]),
  );
  const withItems = [];
  for (const order of orders) {
    const items = await query("SELECT sku, qty FROM order_items WHERE order_id = $1", [order.id]);
    withItems.push({ ...order, items });
  }
  res.json({ orders: withItems, next: orders.at(-1)?.id ?? null });
}
TS
REVIEWED=$(commit "Dana Kim" dana@acme.dev "2026-09-02T15:00:00Z" "api: cursor pagination for users and orders")

cat > src/routes/users.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";

export async function listUsers(req: Request, res: Response) {
  const raw = Number(req.query.limit ?? 20);
  if (!Number.isInteger(raw)) return res.status(400).json({ error: "limit must be an integer" });
  const limit = Math.min(Math.max(raw, 1), 100);
  const after = Number(req.query.after ?? 0);
  const users = await query("SELECT id, name FROM users WHERE id > $1 ORDER BY id LIMIT $2", [after, limit]);
  res.json({ users, next: users.at(-1)?.id ?? null });
}
TS
cat > test/users.test.ts <<'TS'
import { expect, mock, test } from "bun:test";

mock.module("../src/db/pool", () => ({ query: async () => [] }));
const { listUsers } = await import("../src/routes/users");

function res() {
  const r = { code: 200, body: undefined as unknown };
  return Object.assign(r, {
    status(c: number) {
      r.code = c;
      return this;
    },
    json(b: unknown) {
      r.body = b;
      return this;
    },
  });
}

test("rejects a non-numeric limit", async () => {
  const out = res();
  await listUsers({ query: { limit: "abc" } } as never, out as never);
  expect(out.code).toBe(400);
});

test("clamps limit into 1..100", async () => {
  const out = res();
  await listUsers({ query: { limit: "5000" } } as never, out as never);
  expect(out.code).toBe(200);
});
TS
commit "Dana Kim" dana@acme.dev "2026-09-03T09:00:00Z" "users: validate and clamp limit" >/dev/null

cat > src/db/pool.ts <<'TS'
import pg from "pg";

export const pool = new pg.Pool({ max: 10 });

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    client.release();
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    const value = await fn(client);
    await client.query("COMMIT");
    client.release();
    return value;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
TS
cat > src/lib/retry.ts <<'TS'
export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
TS
cat > src/routes/orders.ts <<'TS'
import type { Request, Response } from "express";
import { query } from "../db/pool";
import { retry } from "../lib/retry";

interface Order {
  id: number;
  total: number;
}

export async function listOrders(req: Request, res: Response) {
  const after = Number(req.query.after ?? 0);
  const orders = await retry(() =>
    query<Order>("SELECT id, total FROM orders WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT 50", [
      req.user.id,
      after,
    ]),
  );
  const withItems = [];
  for (const order of orders) {
    const items = await query("SELECT sku, qty FROM order_items WHERE order_id = $1", [order.id]);
    withItems.push({ ...order, items });
  }
  res.json({ orders: withItems, next: orders.at(-1)?.id ?? null });
}
TS
HEAD_SHA=$(commit "Dana Kim" dana@acme.dev "2026-09-03T11:30:00Z" "db: release clients on error, scope orders to the caller")

# The reviewer's checkout still sits on the reviewed commit, behind the pushed head.
git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/users-pagination "$HEAD_SHA"
git reset -q --hard "$REVIEWED"
git branch -q --set-upstream-to=origin/users-pagination

jq -n --arg root "$PWD" --arg base "$BASE" --arg reviewed "$REVIEWED" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.review-snapshot/meta.json" <<'JQ'
{
  root: $root,
  repo: "acme/api-server",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 247,
    title: "Cursor pagination for users and orders",
    author: "dana-k",
    headRefName: "users-pagination",
    createdAt: "2026-09-02T15:05:00Z",
    body: "Adds cursor pagination (`after`, `limit`) to `GET /users` and `GET /orders`.\n\n- [x] Unit tests\n- [x] Load tested pagination against staging"
  },
  reviews: [
    { id: 3101, author: "bendrucker", state: "CHANGES_REQUESTED", submittedAt: "2026-09-02T18:40:00Z", commit: $reviewed, body: "A few things before this can go in." },
    { id: 3102, author: "copilot-pull-request-reviewer", state: "COMMENTED", submittedAt: "2026-09-02T15:20:00Z", commit: $reviewed, body: "" }
  ],
  threads: [
    {
      id: "PRRT_kwDOacme01", isResolved: true, path: "src/routes/users.ts", line: 7,
      comments: [
        { author: "bendrucker", createdAt: "2026-09-02T18:31:00Z", commit: $reviewed, body: "`limit` goes straight from the query string into the SQL `LIMIT`. A negative or huge value either errors in Postgres or pulls the whole table. Clamp it to 1..100 and return a 400 for non-numeric input." },
        { author: "dana-k", createdAt: "2026-09-03T09:05:00Z", commit: $reviewed, body: "Clamped to 1..100 and return 400 on junk, tests added." }
      ]
    },
    {
      id: "PRRT_kwDOacme02", isResolved: true, isOutdated: true, path: "src/db/pool.ts", line: 7,
      comments: [
        { author: "bendrucker", createdAt: "2026-09-02T18:33:00Z", commit: $reviewed, body: "When a query throws, the client never goes back to the pool, here and in `withTransaction`. A burst of bad queries exhausts the pool. Release in a `finally` on every path." },
        { author: "dana-k", createdAt: "2026-09-03T11:35:00Z", commit: $reviewed, body: "done, added a test for the leak" }
      ]
    },
    {
      id: "PRRT_kwDOacme03", isResolved: false, path: "src/routes/orders.ts", line: 20,
      comments: [
        { author: "bendrucker", createdAt: "2026-09-02T18:35:00Z", commit: $reviewed, body: "This loads items once per order, so a page of 50 orders is 51 queries. Fetch the page's items in one `WHERE order_id = ANY($1)` query." },
        { author: "dana-k", createdAt: "2026-09-03T11:36:00Z", commit: $reviewed, body: "Agreed, but it predates pagination. I'd like to do it in a follow-up PR so this one stays small." }
      ]
    },
    {
      id: "PRRT_kwDOacme04", isResolved: true, isOutdated: true, path: "src/lib/retry.ts", line: 1,
      comments: [
        { author: "bendrucker", createdAt: "2026-09-02T18:36:00Z", commit: $reviewed, body: "Nit: `n` reads like a count of items. `attempts`?" }
      ]
    },
    {
      id: "PRRT_kwDOacme05", isResolved: true, isOutdated: true, path: "src/routes/orders.ts", line: 12,
      comments: [
        { author: "bendrucker", createdAt: "2026-09-02T18:38:00Z", commit: $reviewed, body: "The `user_id` filter got dropped, so any caller can page through every customer's orders. Scope the page query to `req.user.id` again." },
        { author: "dana-k", createdAt: "2026-09-03T11:37:00Z", commit: $reviewed, body: "Good catch, restored." }
      ]
    },
    {
      id: "PRRT_kwDOacme06", isResolved: true, path: "src/routes/users.ts", line: 8,
      comments: [
        { author: "copilot-pull-request-reviewer", bot: true, createdAt: "2026-09-02T15:21:00Z", commit: $reviewed, body: "Consider adding a JSDoc comment describing the pagination parameters." }
      ]
    }
  ]
}
JQ
