The render test passes, and `bun run export 8812` fails immediately because there's no Postgres here, so I couldn't reach the slow path. Nothing in the code treats one account differently.

Could you run `EXPLAIN ANALYZE` on the invoice query for account 8812 and paste the plan, or let me add timing around the query and the render?
