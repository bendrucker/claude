---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^wt .* switch --create 
flags: m
match: count:3
---
Exactly 3 new branches were created.
