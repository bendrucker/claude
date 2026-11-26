---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^wt .* switch --create 
flags: m
match: count:2
---
Exactly 2 new branches were created.
