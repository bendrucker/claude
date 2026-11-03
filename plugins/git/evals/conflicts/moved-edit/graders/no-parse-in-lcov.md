---
type: regex
pattern: '(function|const) +parseLcov'
match: not_contains
target: { source: file, path: src/lcov.ts }
---
`src/lcov.ts` no longer defines `parseLcov`.
