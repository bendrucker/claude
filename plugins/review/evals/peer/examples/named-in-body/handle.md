---
fail: [no-author-name]
---
<comments>
**src/invoices.ts** `listInvoices`

@praman `slice(start, size)` treats `size` as the end index, so later pages are empty. Use `slice(start, start + size)`.
</comments>
