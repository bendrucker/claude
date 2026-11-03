---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: src/transcript.ts }
---
`src/transcript.ts` holds no conflict markers.
