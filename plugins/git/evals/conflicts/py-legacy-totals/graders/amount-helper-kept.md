---
type: regex
pattern: 'sum\(_amount\(line\) for line in lines'
match: contains
target: { source: file, path: .eval-pushed-tree/billing/summary.py }
---
Main's `_amount` helper still computes each line.
