---
type: regex
target:
  source: file
  path: src/invoice.test.ts
pattern: 'toBe(?:CloseTo)?\((?:[^()\n]|\([^()\n]*\))*(?:\*|TAX_RATE|Math\.|reduce)|\bconst expected\w*\s*=[^\n;]*[*+]'
match: not_contains
---
No expected value is recomputed with arithmetic, `TAX_RATE`, or `Math`: each is an independent literal.
