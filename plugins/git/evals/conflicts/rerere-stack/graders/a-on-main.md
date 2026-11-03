---
type: regex
pattern: 'pushed: refs/heads/connect-timeout on-main'
match: contains
target: { source: file, path: .eval-pushed }
---
The first branch was pushed on top of main.
