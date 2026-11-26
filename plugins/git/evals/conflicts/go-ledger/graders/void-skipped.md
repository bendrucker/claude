---
type: regex
pattern: 'if t\.Void \{'
match: contains
target: { source: file, path: .eval-pushed-tree/tools/ledgerroll/ledger.go }
---
The branch's skip of voided transactions is kept in `aggregate`.
