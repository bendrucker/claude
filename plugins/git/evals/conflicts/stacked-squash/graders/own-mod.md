---
type: regex
pattern: 'export function parseView\(stdout: string\)'
match: contains
target: { source: file, path: .eval-pushed-tree/plugins/github/mod/pr.ts }
---
The branch's PR watcher module survives.
