---
type: regex
pattern: 'replace\(\s*/\^@/'
match: contains
target: { source: file, path: .eval-pushed-tree/src/reviewers.ts }
---
The branch's leading-@ strip survives in main's no-semicolon style.
