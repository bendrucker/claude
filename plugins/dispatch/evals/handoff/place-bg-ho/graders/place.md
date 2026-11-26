---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch \S+ \S+ place=bg( |$)'
flags: m
match: contains
---
The session ran in the background.
