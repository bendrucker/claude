---
type: regex
pattern: '^\| Permissions and sandbox \|[^\n]*`sandbox-bypass-scaffold`'
flags: m
match: contains
target: { source: file, path: plugins/observability/skills/session/references/discovery.md }
---
main's new query stays in its generated row.
