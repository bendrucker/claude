---
type: regex
pattern: '"zod@4.4.3"'
match: contains
target: { source: file, path: bun.lock }
---
zod stays at the locked 4.4.3.
