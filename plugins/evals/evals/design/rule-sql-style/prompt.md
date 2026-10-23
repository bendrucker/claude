/evals:design .claude/rules/sql.md

Design an eval suite for the SQL rule in `.claude/rules/sql.md` and write it to `evals/sql-rule/`, for `claude plugin eval`. The rule is a context file outside any plugin, so the suite has to load it the way the native runner loads one.

The rule governs two kinds of request: `select` (writing or editing a query) and `migration` (adding or changing a schema migration). Tag each case with its kind.

Sessions that broke it:

> user: add a query that lists a customer's orders
> assistant: `SELECT * FROM orders WHERE customer_id = $1;`
> user: name the columns

> user: fetch these orders by id: 4, 9, 12
> assistant: `SELECT id, total_cents FROM orders WHERE id IN (4, 9, 12);`
> user: pass an array and use ANY

> user: add a shipments table and a shipped_at column on orders
> assistant: wrote `0008_AddShipments.up.sql` with both statements and no down file
> user: snake_case name, a down file, and wrap the two tables in a transaction

> user: add an index on orders.customer_id
> assistant: wrote `0008_index_orders_customer.up.sql` and the matching `.down.sql`
> user: good, no transaction needed for one table
