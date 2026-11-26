---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^launch 
flags: m
match: count:2
---
Exactly 2 sessions were launched.
