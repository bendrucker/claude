---
fail: [no-author-name]
---
<comments>
Priya, `searchCustomers` interpolates `term` into the SQL, which is an injection. Use a `$1` placeholder.
</comments>
