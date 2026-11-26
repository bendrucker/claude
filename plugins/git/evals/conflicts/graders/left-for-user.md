---
type: regex
pattern: '^ref:'
match: not_contains
target: { source: file, path: .git/HEAD }
---
The rebase is still stopped on the resolved conflict, so the continue is left to the user as asked.
