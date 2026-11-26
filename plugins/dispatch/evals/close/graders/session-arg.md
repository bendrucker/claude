---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close (?:close|park)\b.* --session [A-Za-z0-9-]{8,}'
flags: m
match: contains
---
The close or park call names this session by its id.
