---
type: regex
pattern: 'append\(g\.Txns, t\)\n\s*sort\.'
match: not_contains
target: { source: file, path: .eval-pushed-tree/tools/ledgerroll/ledger.go }
---
Main's change holds. Each group sorts once, after the loop.
