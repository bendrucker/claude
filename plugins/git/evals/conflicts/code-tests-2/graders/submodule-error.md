---
type: regex
pattern: 'submoduleError\?: string'
match: contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
main's `submoduleError` record field survives.
