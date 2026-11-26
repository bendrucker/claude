---
type: regex
target: { source: file, path: src/report.ts }
pattern: '(\|\||\?\?)\s*["''`]-["''`]'
---
An empty note renders as `-`, as in the legacy output.
