---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch '
flags: m
match: contains
---
The session launched a dispatched session in the multiplexer.
