---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^\s*([-*+]|\d+[.)])\s[^\n]*(parallel|concurren|goroutine|errgroup|worker pool)'
flags: im
match: contains
---
A notes list item records whether parallelism is in scope.
