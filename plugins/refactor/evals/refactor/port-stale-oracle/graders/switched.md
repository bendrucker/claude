---
type: regex
target: { source: file, path: src/checkout.ts }
pattern: 'legacy/price'
match: not_contains
---
`src/checkout.ts` no longer imports the legacy module.
