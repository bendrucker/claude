Our CSV export endpoint falls over on large accounts. The handler loads every row for an account into memory, builds the whole CSV as one big string, and then sends it. On accounts with a lot of rows the process memory spikes and sometimes the whole thing crashes. I want the export to stream so memory stays roughly flat no matter how many rows an account has, while the client still gets a normal CSV download.

Here is the relevant part of the service. It is a TypeScript HTTP API on Express with a Postgres database. The driver underneath is `pg`.

```
src/
  server.ts            # express app, mounts routers
  routes/
    export.ts          # GET /accounts/:id/export.csv handler (below)
    accounts.ts
  lib/
    db.ts              # pg Pool wrapper: db.query(sql, params), db.pool is the raw Pool
    csv.ts             # toCsvRow(values: string[]) -> string, escapes + joins one row
  middleware/
    auth.ts            # sets req.accountId, checks the caller can read :id
```

`routes/export.ts`:

```ts
import { Router } from "express";
import { db } from "../lib/db";
import { toCsvRow } from "../lib/csv";

export const exportRouter = Router();

const COLUMNS = ["id", "created_at", "email", "plan", "status"];

exportRouter.get("/accounts/:id/export.csv", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, created_at, email, plan, status FROM members WHERE account_id = $1 ORDER BY id",
    [req.params.id],
  );

  const lines = [toCsvRow(COLUMNS)];
  for (const row of rows) {
    lines.push(toCsvRow([row.id, row.created_at, row.email, row.plan, row.status]));
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="export-${req.params.id}.csv"`);
  res.send(lines.join("\n"));
});
```

`lib/db.ts` wraps a single `pg` `Pool`. `db.query` runs a one-shot query and buffers all rows, which is the part that hurts here. `db.pool` exposes the raw `Pool` if you need a dedicated client or anything lower level. `pg` supports server-side cursors and row-at-a-time streaming through `pg-query-stream`, which is not currently a dependency.

The same columns should come out in the same order. This is just the one export endpoint. Plan the implementation.
