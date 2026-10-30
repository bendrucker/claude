---
type: regex
pattern: 'retry: "enter" \| "prompt" \| null'
match: contains
target: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
The branch's `retry` record field survives.
