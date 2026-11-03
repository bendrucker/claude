---
type: regex
pattern: 'CONFIG_LOCK_HELD'
match: contains
target: { source: file, path: .eval-pushed-tree/plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
The branch's held-lock detection survives.
