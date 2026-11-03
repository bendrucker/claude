---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/wait.ts }
---
`src/wait.ts` holds no conflict markers.
