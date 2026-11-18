---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close close\b'
flags: m
match: not_contains
---
The session kept its pane open while CI had not passed.
