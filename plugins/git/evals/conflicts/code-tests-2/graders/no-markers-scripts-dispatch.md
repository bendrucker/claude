---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
`plugins/herdr/skills/herdr/scripts/dispatch.ts` holds no conflict markers.
