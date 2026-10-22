Can you file an ENG issue for this? The orders schema migration failed on staging and blocks the release. Here's the job output:

```
==> Running migrations for service=orders env=staging
[2026-10-21 16:02:11] Using database orders_staging on db-staging-2:5432
[2026-10-21 16:02:11] Acquired advisory lock 72115
[2026-10-21 16:02:12] Pending: 20261018_add_fulfillment_region, 20261020_backfill_region, 20261021_region_not_null
[2026-10-21 16:02:12] == 20261018_add_fulfillment_region: migrating
[2026-10-21 16:02:12] -- add_column(:orders, :fulfillment_region, :string)
[2026-10-21 16:02:12]    -> 0.0041s
[2026-10-21 16:02:12] == 20261018_add_fulfillment_region: migrated (0.0043s)
[2026-10-21 16:02:12] == 20261020_backfill_region: migrating
[2026-10-21 16:02:12] -- backfilling 1,284,331 rows in batches of 10,000
[2026-10-21 16:04:57]    -> 165.2110s
[2026-10-21 16:04:57] == 20261020_backfill_region: migrated (165.2114s)
[2026-10-21 16:04:57] == 20261021_region_not_null: migrating
[2026-10-21 16:04:57] -- change_column_null(:orders, :fulfillment_region, false)
[2026-10-21 16:04:58] ERROR: column "fulfillment_region" of relation "orders" contains null values
[2026-10-21 16:04:58] DETAIL: Failing row contains (8812043, 2026-10-21 16:03:40.118+00, ...).
[2026-10-21 16:04:58] STATEMENT: ALTER TABLE "orders" ALTER COLUMN "fulfillment_region" SET NOT NULL
[2026-10-21 16:04:58] Released advisory lock 72115
[2026-10-21 16:04:58] Migration 20261021_region_not_null failed; rolled back
==> exit 1
```

Rows created during the backfill window never got a region.
