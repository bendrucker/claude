---
type: regex
target: { source: file, path: src/report.ts }
pattern: 'toLocaleString|NumberFormat'
---
Amounts keep the legacy thousands separators.
