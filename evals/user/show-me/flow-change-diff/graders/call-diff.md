---
type: regex
pattern: '^```diff(?=(?:(?!```)[\s\S])*?^-[^\n]*activate)(?=(?:(?!```)[\s\S])*?^\+[^\n]*(?:verif|token))'
flags: mi
match: contains
---
The diff drops the immediate activate call and adds a verification step.
