---
type: regex
target:
  source: file
  path: src/calendar.test.ts
pattern: 'isLeapYear'
match: not_contains
---
The tests reach the bug through `daysInMonth`, not the private `isLeapYear`.
