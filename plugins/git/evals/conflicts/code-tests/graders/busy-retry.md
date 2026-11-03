---
type: regex
pattern: 'BUSY_PAUSE_MS'
match: contains
target: { source: file, path: .eval-pushed-tree/plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
main's busy-pane pause survives.
