---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^launch 
flags: m
match: count:3
---
Exactly 3 sessions were launched.
