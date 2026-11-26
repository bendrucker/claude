---
type: regex
pattern: 'trace_run'
match: not_contains
target: { source: file, path: .eval-pushed-tree/scripts/shell/trace.sh }
---
The `trace_run` helper that main removed stays removed.
