---
type: regex
target: { source: file, path: src/report.ts }
pattern: '\+\s*["''`]\\n["''`]'
---
Output ends with a newline, as the legacy renderer's does.
