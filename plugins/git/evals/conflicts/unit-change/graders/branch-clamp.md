---
type: regex
pattern: 'Math\.max\(options\.timeout, 0\)'
match: contains
target: { source: file, path: src/wait.ts }
---
The branch's clamp survives.
