---
type: regex
target:
  source: file
  path: src/reminders.test.ts
pattern: 'mock\.module|spyOn\(|Bun\.connect\s*='
match: not_contains
---
The tests substitute no module or global: no `mock.module`, no `spyOn`, no patched `Bun.connect`.
