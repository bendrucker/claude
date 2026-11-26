---
type: regex
pattern: 'if not line\.get\("refunded"\)'
match: contains
target: { source: file, path: .eval-pushed-tree/billing/summary.py }
---
The branch's refund filter is applied in the function's new home in `summary.py`.
