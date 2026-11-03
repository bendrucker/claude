---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/tags.ts }
---
`src/tags.ts` holds no conflict markers.
