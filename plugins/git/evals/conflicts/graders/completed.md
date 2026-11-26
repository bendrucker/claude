---
type: regex
pattern: '^operation: complete$'
flags: m
match: contains
target: { source: file, path: .eval-verdicts }
---
The rebase or merge finished, so no operation is left in progress.
