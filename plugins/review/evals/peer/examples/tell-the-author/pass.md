---
fail: []
---
Priya's PR has one blocking issue.

<comments>
**src/customers.ts** `searchCustomers`

`term` goes into the SQL through a template literal, so the lookup box is a SQL injection: a `'` in a name breaks the query, and a crafted one reads any table. Pass it as a parameter, `WHERE name ILIKE $1` with `[`%${term}%`]`, the way `getCustomer` does.
</comments>
