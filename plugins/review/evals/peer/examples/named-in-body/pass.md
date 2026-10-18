---
fail: []
---
<comments>
**src/invoices.ts** `listInvoices`

`all.slice(start, size)` takes `size` as the end index, so page 1 asks for `slice(25, 25)` and every page after the first comes back empty. This should be `slice(start, start + size)`.

**src/invoices.ts** `MAX_PAGE_SIZE`

Nothing reads `MAX_PAGE_SIZE` yet, so a caller can still pass any `size`. I'd clamp `size` to it in `listInvoices`.
</comments>
