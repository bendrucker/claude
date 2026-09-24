---
type: regex
pattern: '^```diff(?=(?:(?!```)[\s\S])*?^\+[^\n]*stream)(?=(?:(?!```)[\s\S])*?^-[^\n]*transport)'
flags: m
match: contains
---
The diff removes transport.ts and adds a stream module.
