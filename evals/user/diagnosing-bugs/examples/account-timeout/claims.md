---
fail: [no-claimed-cause]
---
The root cause is a missing index on invoices.account_id, so account 8812's large history forces a sequential scan.
