---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^launch \S*(?:backoff|reconnect|retry)'
flags: mi
match: contains
---
The launched session's branch names the backoff fix.
