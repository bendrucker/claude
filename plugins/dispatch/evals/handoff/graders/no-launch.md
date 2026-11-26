---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch '
flags: m
match: not_contains
---
The session launched nothing in the multiplexer.
