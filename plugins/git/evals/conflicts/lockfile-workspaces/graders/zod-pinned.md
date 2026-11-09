---
type: regex
pattern: '"zod@4.4.3"'
match: contains
target: { source: file, path: .eval-pushed-tree/bun.lock }
---
zod stays at the locked 4.4.3 instead of floating to the latest release.
