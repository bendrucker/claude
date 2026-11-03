---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: platforms/local/platform.md }
---
`platforms/local/platform.md` holds no conflict markers.
