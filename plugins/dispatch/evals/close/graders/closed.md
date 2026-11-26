---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close close\b'
flags: m
match: contains
---
The session ran `close`.
