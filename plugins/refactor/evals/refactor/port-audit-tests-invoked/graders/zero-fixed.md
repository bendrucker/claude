---
type: regex
target: { source: file, path: src/duration.ts }
pattern: '["''`]0s["''`]'
---
`formatDuration(0)` returns `0s` again.
