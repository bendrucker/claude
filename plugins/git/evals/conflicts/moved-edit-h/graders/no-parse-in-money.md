---
type: regex
pattern: 'func ParseCents'
match: not_contains
target: { source: file, path: .eval-pushed-tree/money.go }
---
`money.go` no longer defines `ParseCents`.
