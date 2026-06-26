Support staff need to track down specific orders, but the list endpoint only takes a customer ID today. They want to filter by order status, by a created-at date range, and by the customer's email address, and they often need several of those at once. Right now the handler dumps every order for a customer. Add filtering and search so support can narrow things down.

Here is the relevant part of the service. It is a TypeScript HTTP API on Express, backed by Postgres. Orders and customers live in separate tables. The email lives on the customers table.

```
src/
  server.ts            # express app, mounts routers
  routes/
    orders.ts          # GET /orders list handler (below)
    fulfillment.ts
  lib/
    db.ts              # pg Pool wrapper: db.query(sql, params) -> { rows }
  middleware/
    auth.ts            # sets req.staffId for support staff requests
```

`routes/orders.ts`:

```ts
import { Router } from "express";
import { db } from "../lib/db";

export const orders = Router();

orders.get("/orders", async (req, res) => {
  const { customerId } = req.query;
  const { rows } = await db.query(
    "SELECT * FROM orders WHERE customer_id = $1",
    [customerId],
  );
  res.json(rows);
});
```

The `customers` table has `id`, `email`, and `name`. The `orders` table has `id`, `customer_id`, `status`, `created_at`, and `total_cents`. There's no index on `status` or `created_at` today.

Status is one of `pending`, `shipped`, `delivered`, or `cancelled`. The date range and email filters are optional, and staff combine them freely (say, every `shipped` order for a given email in the last 30 days). Results should come back paginated so a wide search stays manageable. This is the read side of the orders list, nothing more. Plan the implementation.
