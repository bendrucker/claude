---
type: regex
pattern: 'local-only `pull-request/evals/create-scenarios`'
match: contains
target: { source: file, path: .eval-pushed-tree/CLAUDE.md }
---
The branch's move of the A/B cases to `create-scenarios` survives.
