---
type: regex
pattern: '^```diff(?=(?:(?!```)[\s\S])*?^\+[^\n]*(?:server|jobs|config))(?=(?:(?!```)[\s\S])*?^-[^\n]*config\.ts)'
flags: m
match: contains
---
The diff removes the shared config.ts and adds per-area config.
