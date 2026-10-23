#!/usr/bin/env bash
set -euo pipefail
mkdir -p .claude/rules db/migrations src
cat > .claude/rules/sql.md <<'MD'
---
paths:
  - "**/*.sql"
  - "db/**"
---

# SQL

- Name the columns in a `SELECT`. Never write `SELECT *`.
- Match a list with `= ANY($1)` and a parameter array, not a built `IN (...)` list.
- Write each migration as a pair, `NNNN_name.up.sql` and `NNNN_name.down.sql`, with a lowercase snake_case name.
- Wrap a migration that changes more than one table in `BEGIN` and `COMMIT`.
MD
cat > db/migrations/0007_add_orders.up.sql <<'SQL'
create table orders (
  id bigint primary key,
  customer_id bigint not null,
  total_cents integer not null
);
SQL
cat > db/migrations/0007_add_orders.down.sql <<'SQL'
drop table orders;
SQL
cat > src/orders.sql <<'SQL'
select id, customer_id, total_cents from orders where customer_id = $1;
SQL
