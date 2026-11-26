---
type: regex
pattern: 'pushed: refs/heads/read-timeout on-main'
match: contains
target: { source: file, path: .eval-pushed }
---
The second branch was pushed on top of main.
