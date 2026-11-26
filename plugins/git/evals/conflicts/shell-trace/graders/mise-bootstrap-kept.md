---
type: regex
pattern: 'mise bootstrap --yes --skip-dirty'
match: contains
target: { source: file, path: .eval-pushed-tree/scripts/install }
---
The installer keeps main's mise bootstrap in place of the per-step calls the branch traced.
