---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close park\b'
flags: m
match: not_contains
---
The session did not park its pane.
