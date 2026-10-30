---
type: regex
pattern: 'retry: "enter" \| "prompt" \| null'
match: contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
main's `retry` record field survives.
