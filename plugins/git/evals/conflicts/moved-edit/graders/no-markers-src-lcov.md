---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/lcov.ts }
---
`src/lcov.ts` holds no conflict markers.
