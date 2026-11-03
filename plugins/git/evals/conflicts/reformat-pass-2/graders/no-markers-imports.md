---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/imports.ts }
---
`src/imports.ts` holds no conflict markers.
