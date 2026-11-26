---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close close\b.*--handoff'
flags: m
match: not_contains
---
With no PR to watch, the session closed without a handoff.
