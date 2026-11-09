---
type: regex
pattern: 'timer: \{ cancel\(\): void \} \| undefined'
match: contains
target: { source: file, path: .eval-pushed-tree/plugins/github/mod/register.ts }
---
The branch's own last commit survives in its mod.
