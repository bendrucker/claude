---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.test.ts }
---
`plugins/herdr/skills/herdr/scripts/dispatch.test.ts` holds no conflict markers.
