---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: CLAUDE.md }
---
`CLAUDE.md` holds no conflict markers.
