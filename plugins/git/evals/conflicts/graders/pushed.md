---
type: regex
pattern: '^pushed: refs/heads/\S+ on-main$'
flags: m
match: contains
target: { source: file, path: .eval-pushed }
---
The resolved branch reached the remote, with main in its history.
