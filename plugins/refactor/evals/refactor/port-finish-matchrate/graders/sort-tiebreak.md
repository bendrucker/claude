---
type: regex
target: { source: file, path: src/report.ts }
pattern: 'localeCompare|\.name\s*[<>]'
---
Equal amounts sort by name, as the legacy comparator does.
