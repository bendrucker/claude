---
type: regex
target:
  source: file
  path: src/token.ts
pattern: 'isExpired\(\s*token\s*:\s*Token\s*,'
match: contains
---
`isExpired` takes the current time or a clock as a parameter.
