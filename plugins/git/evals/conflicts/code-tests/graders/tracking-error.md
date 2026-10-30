---
type: regex
pattern: 'trackingError\?: string'
match: contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
The branch's `trackingError` record field survives.
