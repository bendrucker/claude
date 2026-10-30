---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: packages/judge/package.json }
---
`packages/judge/package.json` holds no conflict markers.
