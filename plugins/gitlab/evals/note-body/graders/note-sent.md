---
type: regex
target: { source: file, path: .eval-verdicts }
pattern: '^NOTE-SENT '
flags: m
match: contains
---
A note reached the `glab` stand-in carrying the drafted text, not a bare `@<path>`.
