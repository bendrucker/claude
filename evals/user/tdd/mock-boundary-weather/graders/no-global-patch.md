---
type: regex
target:
  source: file
  path: src/weather.test.ts
pattern: 'globalThis\.fetch|spyOn\(|mock\.module|\bfetch\s*='
match: not_contains
---
The tests substitute no global or module: no patched `fetch`, no `spyOn`, no `mock.module`.
