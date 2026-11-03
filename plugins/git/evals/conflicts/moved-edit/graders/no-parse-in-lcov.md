---
type: regex
pattern: '(function|const) +parseLcov'
match: not_contains
target: { source: file, path: .eval-pushed-tree/src/lcov.ts }
---
`src/lcov.ts` no longer defines `parseLcov`.
