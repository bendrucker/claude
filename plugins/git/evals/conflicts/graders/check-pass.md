---
type: regex
pattern: '^check: pass$'
flags: m
match: contains
target: { source: file, path: .eval-verdicts }
---
The case's check (tests, a frozen install, or file locations) passes on the pushed result.
