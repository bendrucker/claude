---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/lcov.test.ts }
---
`src/lcov.test.ts` holds no conflict markers.
