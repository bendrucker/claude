---
type: regex
pattern: '^```diff(?=(?:(?!```)[\s\S])*?^\+[^\n]*(?:users|invoices|reports))(?=(?:(?!```)[\s\S])*?^-[^\n]*routes\.ts)'
flags: mi
match: contains
---
The diff removes the single routes.ts and adds per-resource files.
