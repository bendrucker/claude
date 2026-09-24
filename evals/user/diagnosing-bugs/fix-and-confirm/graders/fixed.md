---
type: regex
target: { source: file, path: src/checkout.ts }
pattern: 'product!\.price'
match: not_contains
---
The unsafe non-null assertion on the missing product is gone.
