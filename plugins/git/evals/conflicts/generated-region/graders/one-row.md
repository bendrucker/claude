---
type: regex
pattern: '^\| Tool failures \|'
flags: m
match: 'count:1'
target: { source: file, path: plugins/observability/skills/session/references/discovery.md }
---
The generated table keeps one Tool failures row.
