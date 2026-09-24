---
type: regex
target:
  source: file
  path: src/weather.ts
pattern: 'summary\(\s*city\s*:\s*string\s*,'
match: contains
---
`summary` takes its HTTP dependency as a parameter, so the seam sits at the argument.
