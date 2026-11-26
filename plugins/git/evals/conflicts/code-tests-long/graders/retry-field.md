---
type: regex
pattern: 'retry: "enter" \| "prompt" \| null'
match: contains
target: { source: file, path: .eval-pushed-tree/plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
main's `retry` record field survives.
