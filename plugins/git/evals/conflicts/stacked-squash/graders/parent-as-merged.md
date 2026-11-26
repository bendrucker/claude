---
type: regex
pattern: '^match: no'
flags: m
match: not_contains
target: { source: file, path: .eval-verdicts }
---
Every file of the parent branch that merged under this one matches main's merged version.
