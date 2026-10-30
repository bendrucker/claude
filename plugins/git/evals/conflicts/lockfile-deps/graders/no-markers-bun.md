---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: bun.lock }
---
`bun.lock` holds no conflict markers.
