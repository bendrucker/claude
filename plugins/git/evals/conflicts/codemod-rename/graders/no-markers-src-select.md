---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/select.ts }
---
`src/select.ts` holds no conflict markers.
