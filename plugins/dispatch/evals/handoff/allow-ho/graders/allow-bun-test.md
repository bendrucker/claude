---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^allow Bash\(bun test
flags: m
match: contains
---
The new session's settings allow running `bun test`.
