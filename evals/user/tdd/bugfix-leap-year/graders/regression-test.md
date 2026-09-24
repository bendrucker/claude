---
type: regex
target:
  source: file
  path: src/calendar.test.ts
pattern: 'daysInMonth\(\s*1900\s*,\s*2\s*\)'
match: contains
---
A test reproduces the reported input, `daysInMonth(1900, 2)`.
