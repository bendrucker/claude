---
type: regex
pattern: 'sort\.SliceStable\(g\.Txns'
match: contains
target: { source: file, path: .eval-pushed-tree/tools/ledgerroll/ledger.go }
---
The branch's stable sort of each group is kept.
