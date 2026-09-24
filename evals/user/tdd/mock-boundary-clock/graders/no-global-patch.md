---
type: regex
target:
  source: file
  path: src/token.test.ts
pattern: 'spyOn\(|setSystemTime|useFakeTimers|Date\.now\s*='
match: not_contains
---
The tests substitute no global clock: no `spyOn`, `setSystemTime`, fake timers, or reassigned `Date.now`.
