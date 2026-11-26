---
type: regex
pattern: '^pushed: refs/heads/(?!main )\S+ on-main$'
flags: m
match: contains
target: { source: file, path: .eval-pushed }
---
The resolved branch reached the remote, with main in its history.
