---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: plugins/github/README.md }
---
`plugins/github/README.md` holds no conflict markers.
