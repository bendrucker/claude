---
type: regex
pattern: '^markers: none$'
flags: m
match: contains
target: { source: file, path: .eval-verdicts }
---
The pushed result holds no conflict markers.
