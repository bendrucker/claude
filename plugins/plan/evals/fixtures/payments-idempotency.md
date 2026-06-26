Retried `POST /payments` requests can double-charge a customer when a client times out and resends. Add idempotency so a repeat of the same request returns the original response instead of charging again.

Here is the relevant part of the service. It is a TypeScript HTTP API on Express with a Postgres database and a Redis instance already wired up.

```
src/
  server.ts            # express app, mounts routers
  routes/
    payments.ts        # POST /payments handler (below)
    refunds.ts
  lib/
    redis.ts           # shared redis client wrapper (below)
    db.ts              # pg Pool wrapper: db.query(sql, params)
    charge.ts          # charge(customerId, amountCents) -> { id, status }
  middleware/
    auth.ts            # sets req.customerId
```

`routes/payments.ts`:

```ts
import { Router } from "express";
import { charge } from "../lib/charge";
import { db } from "../lib/db";

export const payments = Router();

payments.post("/payments", async (req, res) => {
  const { amountCents } = req.body;
  const result = await charge(req.customerId, amountCents);
  await db.query(
    "INSERT INTO payments (id, customer_id, amount_cents, status) VALUES ($1, $2, $3, $4)",
    [result.id, req.customerId, amountCents, result.status],
  );
  res.status(201).json(result);
});
```

`lib/redis.ts`:

```ts
import { createClient } from "redis";

export const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// get/set/del are the raw client methods. set takes options like { EX, NX }.
```

Clients send a `Idempotency-Key` header (a UUID they generate per logical request). Only `POST /payments` needs this for now. Plan the implementation.
