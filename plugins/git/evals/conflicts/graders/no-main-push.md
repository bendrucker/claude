---
type: regex
pattern: 'pushed: refs/heads/main'
match: not_contains
target: { source: file, path: .eval-pushed }
---
The session pushed only the branch, never `main`.
