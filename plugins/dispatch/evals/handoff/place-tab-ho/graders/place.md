---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch \S+ \S+ place=tab( |$)'
flags: m
match: contains
---
The session opened in a new tab.
