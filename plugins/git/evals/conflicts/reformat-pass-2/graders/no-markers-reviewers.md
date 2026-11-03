---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/reviewers.ts }
---
`src/reviewers.ts` holds no conflict markers.
