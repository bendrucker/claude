---
type: regex
target: trace
pattern: '"command": ?"(?:[^"\\]|\\.)*\bgit commit\b'
match: contains
---
The session committed the change.
