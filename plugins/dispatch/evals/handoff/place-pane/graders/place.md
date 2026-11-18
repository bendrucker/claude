---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch \S+ \S+ place=pane( |$)'
flags: m
match: contains
---
The session opened in a pane in this tab.
