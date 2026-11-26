---
type: regex
target: { source: file, path: src/report.ts }
pattern: 'join\(\s*["''`] \| ["''`]\s*\)'
---
Columns are joined with the legacy ` | ` separator.
