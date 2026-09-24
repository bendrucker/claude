---
type: regex
target:
  source: file
  path: src/settings.test.ts
pattern: 'readFileSync|Bun\.file|JSON\.parse'
match: not_contains
---
The tests never read the settings file directly.
