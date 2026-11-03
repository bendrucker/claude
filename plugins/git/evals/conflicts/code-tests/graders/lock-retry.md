---
type: regex
pattern: 'CONFIG_LOCK_HELD'
match: contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
The branch's held-lock detection survives.
