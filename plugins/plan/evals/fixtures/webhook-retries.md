When a customer's webhook endpoint is down or times out, we lose the event. `deliver` does one `fetch` and just logs the failure, so the customer never finds out an order shipped or a payment cleared. Add retry with backoff and dead-letter a delivery after a few failed attempts instead of dropping it.

Here is the relevant part of the service. It is a Node + TypeScript backend on Postgres. There is no message broker.

```
src/
  index.ts             # service entrypoint, starts the HTTP server + workers
  lib/
    webhooks.ts        # outbound delivery (below)
    db.ts              # pg Pool wrapper: db.query(sql, params)
    events.ts          # records inbound events, enqueues outbound deliveries
  workers/
    jobs.ts            # claims rows from the `jobs` table and runs handlers
  handlers/
    inbound.ts         # receives webhooks FROM third parties (separate concern)
```

`lib/webhooks.ts`:

```ts
import { db } from "./db";

export async function deliver(subscriptionId: string, payload: unknown) {
  const sub = await db.query(
    "SELECT url, secret FROM webhook_subscriptions WHERE id = $1",
    [subscriptionId],
  );
  const { url, secret } = sub.rows[0];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign(payload, secret) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    console.error(`webhook ${subscriptionId} failed`, err);
  }
}
```

There is already a `jobs` table that the worker drains. It looks like this:

```sql
CREATE TABLE jobs (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  args        JSONB NOT NULL,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts    INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending'
);
```

`workers/jobs.ts` polls for `status = 'pending' AND run_at <= now()`, runs the handler for the row's `kind`, and marks it `done`. Right now nothing registers a `kind` for webhook delivery. `deliver` is called directly from `events.ts`.

We need failed deliveries to be retried on a backoff and dead-lettered after a cap (say a handful of attempts), so a flaky customer endpoint doesn't lose events. This is only about outbound delivery. Inbound webhook handling in `handlers/inbound.ts` is out of scope, and I don't want a broker or a rewrite of the job worker. Plan the implementation.
