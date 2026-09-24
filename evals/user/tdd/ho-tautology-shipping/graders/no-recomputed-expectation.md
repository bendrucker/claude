---
type: regex
target:
  source: file
  path: src/shipping.test.ts
pattern: 'toBe(?:CloseTo)?\((?:[^()\n]|\([^()\n]*\))*(?:\*|\+|BASE_CENTS|PER_KG_CENTS|Math\.)|\bconst expected\w*\s*=[^\n;]*[*+]'
match: not_contains
---
No expected value is recomputed with arithmetic or the module's rate constants: each is an independent literal.
