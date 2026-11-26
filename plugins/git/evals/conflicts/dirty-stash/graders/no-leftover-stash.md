---
type: regex
pattern: '^[^\n]*\n?$'
match: contains
target: { source: file, path: .git/logs/refs/stash }
---
The session left no stash entry of its own.
